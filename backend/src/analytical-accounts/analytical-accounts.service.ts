import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnalyticalAccountDto } from './dto/create-analytical-account.dto';
import { QueryAnalyticalAccountsDto } from './dto/query-analytical-accounts.dto';
import { AnalyticalStatementQueryDto } from './dto/statement-query.dto';

/**
 * Analytical Accounts: extensible non-customer accounting accounts
 * (debtors, employee advances, employee custodies, and future categories).
 *
 * Deliberately isolated from Customer/CustomerBalance:
 * - never reads or writes accountingBalance/operationalBalance
 * - never touches Collection/CustomerAssignment/PaymentPromise
 * Imported movements (AnalyticalMovement) are append-only/read-only — no
 * update/delete endpoint is exposed for them, matching the imported
 * transaction ledger pattern used elsewhere in the app.
 */
@Injectable()
export class AnalyticalAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async findScoped(actor: AuthUser, id: string) {
    const account = await this.prisma.analyticalAccount.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!account) throw new NotFoundException('Analytical account not found');
    return account;
  }

  private async withBalance<T extends { id: string; currencyCode: string }>(rows: T[]) {
    if (rows.length === 0) return [] as (T & { balance: number })[];
    const sums = await this.prisma.analyticalMovement.groupBy({
      by: ['accountId'],
      where: { accountId: { in: rows.map((r) => r.id) } },
      _sum: { debit: true, credit: true },
    });
    const balanceMap = new Map(
      sums.map((s) => [s.accountId, Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)]),
    );
    return rows.map((r) => ({ ...r, balance: balanceMap.get(r.id) ?? 0 }));
  }

  async findAll(actor: AuthUser, q: QueryAnalyticalAccountsDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where: Record<string, unknown> = { organizationId: actor.organizationId };
    if (q.category) where.category = q.category;
    if (q.currencyCode) where.currencyCode = q.currencyCode;
    if (q.status) where.status = q.status;
    if (q.search) {
      const s = q.search.trim();
      where.OR = [
        { accountNumber: { contains: s, mode: 'insensitive' } },
        { accountName: { contains: s, mode: 'insensitive' } },
        { personName: { contains: s, mode: 'insensitive' } },
        { employeeNumber: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [total, accounts] = await Promise.all([
      this.prisma.analyticalAccount.count({ where }),
      this.prisma.analyticalAccount.findMany({
        where,
        orderBy: { accountNumber: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      page, limit, total, totalPages: Math.ceil(total / limit),
      items: await this.withBalance(accounts),
    };
  }

  async findOne(actor: AuthUser, id: string) {
    const account = await this.findScoped(actor, id);
    const [withBalance] = await this.withBalance([account]);
    return withBalance;
  }

  async statement(actor: AuthUser, id: string, q: AnalyticalStatementQueryDto) {
    await this.findScoped(actor, id);
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;

    const total = await this.prisma.analyticalMovement.count({ where: { accountId: id } });
    const before = await this.prisma.analyticalMovement.findMany({
      where: { accountId: id },
      orderBy: [{ txDate: 'asc' }, { sourceRowNumber: 'asc' }],
      take: (page - 1) * limit,
      select: { debit: true, credit: true },
    });
    let running = before.reduce((s, m) => s + Number(m.debit) - Number(m.credit), 0);

    const movements = await this.prisma.analyticalMovement.findMany({
      where: { accountId: id },
      orderBy: [{ txDate: 'asc' }, { sourceRowNumber: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const items = movements.map((m) => {
      running += Number(m.debit) - Number(m.credit);
      return {
        date: m.txDate,
        documentType: m.documentType,
        documentNumber: m.documentNumber,
        description: m.description,
        debit: Number(m.debit),
        credit: Number(m.credit),
        runningBalance: running,
      };
    });

    return { page, limit, total, totalPages: Math.ceil(total / limit), items };
  }

  async create(actor: AuthUser, dto: CreateAnalyticalAccountDto, req?: Request) {
    const currency = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode } });
    if (!currency) throw new BadRequestException('Unknown currency code');

    const existing = await this.prisma.analyticalAccount.findUnique({
      where: {
        organizationId_accountNumber_currencyCode: {
          organizationId: actor.organizationId,
          accountNumber: dto.accountNumber,
          currencyCode: dto.currencyCode,
        },
      },
    });
    if (existing) throw new BadRequestException('An account with this number and currency already exists');

    const account = await this.prisma.analyticalAccount.create({
      data: {
        organizationId: actor.organizationId,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        category: dto.category,
        personName: dto.personName,
        employeeNumber: dto.employeeNumber,
        currencyCode: dto.currencyCode,
        metadata: dto.metadata as any,
        createdBy: actor.id,
      },
    });

    await this.audit.log({
      userId: actor.id, action: 'analytical_account_created', entityTable: 'analytical_accounts',
      entityId: account.id,
      newValue: { accountNumber: dto.accountNumber, accountName: dto.accountName, category: dto.category },
      req,
    });
    return account;
  }

  // ---------------------------------------------------------------------
  // CSV import — two layouts (debtor / employee). Column parsing only;
  // no Excel binary parsing dependency introduced. Movements are inserted
  // append-only and deduped by lineHash; accounts are upserted (created on
  // first sight, name/person/employee fields refreshed on later imports).
  // ---------------------------------------------------------------------
  async importCsv(actor: AuthUser, layout: 'debtor' | 'employee', file: Express.Multer.File, req?: Request) {
    if (!file) throw new BadRequestException('File is required');
    const text = file.buffer.toString('utf-8');
    const rows = parseCsv(text);
    if (rows.length < 2) throw new BadRequestException('File has no data rows');

    const dataRows = rows.slice(1); // skip header row
    const currencies = new Set((await this.prisma.currency.findMany({ select: { code: true } })).map((c) => c.code));

    let accountsCreated = 0;
    let accountsUpdated = 0;
    let movementsInserted = 0;
    let movementsSkippedDuplicate = 0;
    const errors: { rowNumber: number; message: string }[] = [];

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const importJob = await this.prisma.importJob.create({
      data: {
        organizationId: actor.organizationId,
        fileName: file.originalname,
        fileHash,
        uploadedBy: actor.id,
        status: 'completed',
      },
    });

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2; // account for header row + 1-based
      const cols = dataRows[i];
      if (cols.every((c) => c.trim() === '')) continue;

      try {
        const parsed = layout === 'debtor' ? parseDebtorRow(cols) : parseEmployeeRow(cols);
        if (!currencies.has(parsed.currencyCode)) {
          throw new Error(`Unknown currency code "${parsed.currencyCode}"`);
        }

        const accountKey = {
          organizationId_accountNumber_currencyCode: {
            organizationId: actor.organizationId,
            accountNumber: parsed.accountNumber,
            currencyCode: parsed.currencyCode,
          },
        } as const;
        const existingAccount = await this.prisma.analyticalAccount.findUnique({ where: accountKey });

        const account = existingAccount
          ? await this.prisma.analyticalAccount.update({
              where: accountKey,
              data: {
                accountName: parsed.accountName,
                personName: parsed.personName ?? undefined,
                employeeNumber: parsed.employeeNumber ?? undefined,
              },
            })
          : await this.prisma.analyticalAccount.create({
              data: {
                organizationId: actor.organizationId,
                accountNumber: parsed.accountNumber,
                accountName: parsed.accountName,
                category: layout === 'debtor' ? 'debtor' : 'employee_advance',
                personName: parsed.personName,
                employeeNumber: parsed.employeeNumber,
                currencyCode: parsed.currencyCode,
                createdBy: actor.id,
              },
            });
        if (existingAccount) accountsUpdated += 1;
        else accountsCreated += 1;

        const lineHash = createHash('sha256')
          .update([
            actor.organizationId, parsed.accountNumber, parsed.currencyCode, parsed.date,
            parsed.docType, parsed.docNo, parsed.debit, parsed.credit, rowNumber,
          ].join('|'))
          .digest('hex');

        const already = await this.prisma.analyticalMovement.findUnique({ where: { lineHash } });
        if (already) { movementsSkippedDuplicate += 1; continue; }

        await this.prisma.analyticalMovement.create({
          data: {
            accountId: account.id,
            currencyCode: parsed.currencyCode,
            txDate: new Date(parsed.date),
            documentType: parsed.docType || null,
            documentNumber: parsed.docNo || null,
            description: parsed.description || null,
            debit: parsed.debit,
            credit: parsed.credit,
            sourceImportJobId: importJob.id,
            sourceRowNumber: rowNumber,
            lineHash,
          },
        });
        movementsInserted += 1;
      } catch (e) {
        errors.push({ rowNumber, message: e instanceof Error ? e.message : String(e) });
      }
    }

    await this.prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        rowsTotal: dataRows.length,
        txnsInserted: movementsInserted,
        txnsSkippedDuplicate: movementsSkippedDuplicate,
        errorsCount: errors.length,
        errorReport: errors.length ? (errors as any) : undefined,
      },
    });

    await this.audit.log({
      userId: actor.id, action: 'analytical_accounts_imported', entityTable: 'analytical_accounts',
      entityId: importJob.id,
      newValue: { layout, accountsCreated, accountsUpdated, movementsInserted, movementsSkippedDuplicate, errors: errors.length },
      req,
    });

    return {
      importJobId: importJob.id,
      accountsCreated, accountsUpdated, movementsInserted, movementsSkippedDuplicate,
      errors,
    };
  }
}

/* ─────────────────────────── CSV parsing helpers ─────────────────────────── */

/**
 * Minimal RFC4180-style CSV parser (no external dependency — none is present
 * in this repo). Handles quoted fields, commas and newlines inside quotes,
 * "" as an escaped quote, and both CRLF and LF line endings. Operates on the
 * already utf-8-decoded string, so Arabic content passes through unchanged.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => { row.push(field.trim()); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { pushField(); i += 1; continue; }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow(); i += 1; continue;
    }
    if (ch === '\n') { pushRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (field.length > 0 || row.length > 0) pushRow(); // trailing field/row if file has no final newline

  // Drop fully-blank lines (e.g. a trailing empty line) — same behavior as before.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * Parses a debit/credit cell. Empty (after trim) is treated as 0. Any
 * non-empty value that isn't a finite number — stray text, "NaN", "Infinity",
 * etc. — is rejected rather than silently coerced to 0, so bad data surfaces
 * as a row-level import error instead of a wrong zero-amount movement.
 */
function parseAmount(raw: string | undefined, fieldLabel: string): number {
  const s = (raw ?? '').trim();
  if (s === '') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${fieldLabel} value "${raw}"`);
  }
  return n;
}

interface ParsedMovementRow {
  accountNumber: string;
  accountName: string;
  personName?: string;
  employeeNumber?: string;
  currencyCode: string;
  date: string;
  docType: string;
  docNo: string;
  description: string;
  debit: number;
  credit: number;
}

// debtor layout: account number, analytical account, currency, date, doc type, doc no, description, debit, credit
function parseDebtorRow(cols: string[]): ParsedMovementRow {
  const [accountNumber, accountName, currencyCode, date, docType, docNo, description, debit, credit] = cols;
  if (!accountNumber || !accountName || !currencyCode || !date) {
    throw new Error('Missing required column(s): account number, analytical account, currency, or date');
  }
  return {
    accountNumber, accountName, currencyCode: currencyCode.toUpperCase(), date,
    docType: docType ?? '', docNo: docNo ?? '', description: description ?? '',
    debit: parseAmount(debit, 'debit'), credit: parseAmount(credit, 'credit'),
  };
}

// employee layout: employee no, employee name, account no/name, currency, date, doc type, doc no, description, debit, credit
function parseEmployeeRow(cols: string[]): ParsedMovementRow {
  const [employeeNumber, employeeName, accountNumber, currencyCode, date, docType, docNo, description, debit, credit] = cols;
  if (!employeeNumber || !accountNumber || !currencyCode || !date) {
    throw new Error('Missing required column(s): employee no, account no/name, currency, or date');
  }
  return {
    accountNumber, accountName: accountNumber, personName: employeeName, employeeNumber,
    currencyCode: currencyCode.toUpperCase(), date,
    docType: docType ?? '', docNo: docNo ?? '', description: description ?? '',
    debit: parseAmount(debit, 'debit'), credit: parseAmount(credit, 'credit'),
  };
}
