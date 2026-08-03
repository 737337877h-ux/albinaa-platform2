import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { Request } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RiskRefreshService } from '../risk/risk-refresh.service';
import { ImportProfile, ParseResultJson, ParserService } from './parser.service';

const CHUNK = 500;

/** مفاتيح فئات تقسيم الأعمار الثابتة — تطابق DETAILS_BUCKET_KEYS في الـ Parser. */
const AGING_BUCKET_KEYS = ['0-30', '31-60', '61-90', '91-120', '120+'] as const;

/** تطبيع اسم لكشف التشابه — مطابق لدالة الـ Parser (موثق في مرحلة التحقق). */
function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly uploadDir = process.env.UPLOAD_DIR ?? path.resolve('uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ParserService,
    private readonly audit: AuditService,
    @Optional() private readonly riskRefresh?: RiskRefreshService,
  ) {}

  // --------------------------------------------------------------------------
  // المرحلة 1+2+3+4 من الـ Workflow: رفع + تحقق + تحليل + معاينة (dry_run)
  // --------------------------------------------------------------------------
  async upload(actor: AuthUser, file: Express.Multer.File, req?: Request) {
    if (!file) throw new BadRequestException('لم يُرفق ملف — الحقل المطلوب: file');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xlsm', '.xls'].includes(ext)) {
      throw new BadRequestException(
        'الصيغ المدعومة: xlsx / xlsm / xls (نصي مفصول بـ Tab بترميز Windows-1256)',
      );
    }

    await fs.mkdir(this.uploadDir, { recursive: true });
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // تحذير تكرار الملف (بدون منع — إعادة الاستيراد آمنة بحكم line_hash)
    const previousJob = await this.prisma.importJob.findFirst({
      where: { organizationId: actor.organizationId, fileHash, status: 'completed' },
      orderBy: { importedAt: 'desc' },
    });

    const storedName = `${Date.now()}_${fileHash.slice(0, 12)}${ext}`;
    const storedPath = path.join(this.uploadDir, storedName);
    await fs.writeFile(storedPath, file.buffer);

    // تحليل فعلي عبر الـ Parser المُختبر — يحدد نوع الملف ويملأ حقوله
    const parsed = await this.parser.parse(storedPath);
    const profile = parsed.profile ?? 'CUSTOMER_STATEMENT_DETAILS';

    // أخطاء إضافية على مستوى القواعد (لا توقف الاستيراد — تُسجَّل ويُتابع)
    const knownCurrencies = new Set(
      (await this.prisma.currency.findMany({ where: { active: true } })).map((c) => c.code),
    );
    const validation = this.validateProfile(profile, parsed, knownCurrencies);

    // حفظ ناتج التحليل بجانب الملف — التنفيذ لاحقًا لا يعيد التحليل
    const parsedPath = `${storedPath}.parsed.json`;
    await fs.writeFile(parsedPath, JSON.stringify(parsed), 'utf-8');

    const job = await this.prisma.importJob.create({
      data: {
        organizationId: actor.organizationId,
        fileName: file.originalname,
        fileHash,
        uploadedBy: actor.id,
        status: 'dry_run',
        rowsTotal: profile === 'CUSTOMER_STATEMENT_DETAILS'
          ? parsed.stats.transactions + parsed.stats.errors + parsed.skippedEmptyRows
          : parsed.stats.rows ?? 0,
        txnsInFile: profile === 'CUSTOMER_STATEMENT_DETAILS' ? parsed.stats.transactions : null,
        errorsCount: parsed.stats.errors + validation.ruleErrors.length,
        errorReport: {
          storedPath,
          parsedPath,
          profile,
          format: parsed.format ?? 'xlsx',
          executable: validation.executable,
          deferredReason: validation.deferredReason,
          parserErrors: parsed.errors,
          ruleErrors: validation.ruleErrors,
          accountWarnings: profile === 'CUSTOMER_STATEMENT_DETAILS'
            ? parsed.accounts
                .filter((a) => a.warnings.length)
                .map((a) => ({ account: `${a.customerCode}/${a.currency}`, warnings: a.warnings }))
            : [],
        } as any,
      },
    });

    await this.audit.log({
      userId: actor.id, action: 'import_uploaded', entityTable: 'import_jobs', entityId: job.id,
      newValue: { fileName: file.originalname, fileHash, profile }, req,
    });

    // المعاينة — المرحلة 4 من الـ Workflow
    return {
      jobId: job.id,
      status: 'dry_run',
      previouslyImported: previousJob
        ? { jobId: previousJob.id, importedAt: previousJob.importedAt }
        : null,
      preview: this.buildPreview(profile, parsed, validation),
      nextStep: `POST /imports/${job.id}/execute لاعتماد الاستيراد`,
    };
  }

  /** قواعد التحقق حسب نوع الملف — تُسجَّل الأخطاء ويستمر الفحص. */
  private validateProfile(
    profile: ImportProfile,
    parsed: ParseResultJson,
    knownCurrencies: Set<string>,
  ): {
    ruleErrors: { rowNumber: number | null; message: string; context?: string }[];
    importable: Record<string, number>;
    executable: boolean;
    deferredReason: string | null;
  } {
    const ruleErrors: { rowNumber: number | null; message: string; context?: string }[] = [];

    if (profile === 'CUSTOMER_STATEMENT_DETAILS') {
      let importableAccounts = 0;
      let importableTxns = 0;
      for (const acc of parsed.accounts) {
        if (!acc.customerCode || acc.customerCode === 'None') {
          ruleErrors.push({
            rowNumber: null,
            message: 'كود عميل ناقص — الحساب مستبعد بالكامل',
            context: acc.customerName,
          });
          continue;
        }
        if (!knownCurrencies.has(acc.currency)) {
          ruleErrors.push({
            rowNumber: null,
            message: `عملة غير معروفة (${acc.currencyRaw}) — الحساب مستبعد. أضفها من الإعدادات ثم أعد التنفيذ`,
            context: `${acc.customerCode} ${acc.customerName}`,
          });
          continue;
        }
        importableAccounts += 1;
        importableTxns += acc.transactions.length;
      }
      return {
        ruleErrors,
        importable: { accounts: importableAccounts, transactions: importableTxns },
        executable: true,
        deferredReason: null,
      };
    }

    if (profile === 'CUSTOMER_MASTER') {
      let valid = 0;
      for (const row of parsed.customers) {
        if (!row.customerCode || row.customerCode === 'None') {
          ruleErrors.push({
            rowNumber: row.rowNumber,
            message: 'كود عميل ناقص — الصف مستبعد',
            context: row.customerName,
          });
          continue;
        }
        if (!row.customerName) {
          ruleErrors.push({
            rowNumber: row.rowNumber,
            message: 'اسم عميل ناقص — الصف مستبعد',
            context: row.customerCode,
          });
          continue;
        }
        valid += 1;
      }
      return {
        ruleErrors,
        importable: { customers: valid },
        executable: true,
        deferredReason: null,
      };
    }

    if (profile === 'CUSTOMER_BALANCE_SUMMARY') {
      let valid = 0;
      for (const row of parsed.balances) {
        if (!row.customerCode || row.customerCode === 'None') {
          ruleErrors.push({
            rowNumber: row.rowNumber,
            message: 'كود عميل ناقص — الصف مستبعد',
            context: row.customerName,
          });
          continue;
        }
        if (!row.currency) {
          ruleErrors.push({
            rowNumber: row.rowNumber,
            message: 'عملة ناقصة — الصف مستبعد',
            context: row.customerCode,
          });
          continue;
        }
        if (!knownCurrencies.has(row.currency)) {
          ruleErrors.push({
            rowNumber: row.rowNumber,
            message: `عملة غير معروفة (${row.currencyRaw}) — الصف مستبعد. أضفها من الإعدادات ثم أعد التنفيذ`,
            context: `${row.customerCode} ${row.customerName}`,
          });
          continue;
        }
        if (row.balance == null) {
          ruleErrors.push({
            rowNumber: row.rowNumber,
            message: 'رصيد غير صالح — الصف مستبعد',
            context: `${row.customerCode} ${row.currency}`,
          });
          continue;
        }
        valid += 1;
      }
      return {
        ruleErrors,
        importable: { balances: valid },
        executable: true,
        deferredReason: null,
      };
    }

    // DEBT_AGING_* — قواعد مثل الأرصدة: العملة فقط تُفحص، والتنفيذ متاح (PR 3)
    const rows = profile === 'DEBT_AGING_SUMMARY' ? parsed.agingSummary : parsed.agingDetails;
    let valid = 0;
    for (const row of rows) {
      if (!row.currency) {
        ruleErrors.push({
          rowNumber: row.rowNumber,
          message: 'عملة ناقصة — الصف مستبعد',
          context: row.customerCode ?? undefined,
        });
        continue;
      }
      if (!knownCurrencies.has(row.currency)) {
        ruleErrors.push({
          rowNumber: row.rowNumber,
          message: `عملة غير معروفة (${row.currencyRaw}) — الصف مستبعد`,
          context: row.customerCode ?? row.currencyRaw,
        });
        continue;
      }
      valid += 1;
    }
    return {
      ruleErrors,
      importable: { rows: valid },
      executable: true,
      deferredReason: null,
    };
  }

  /** معاينة حسب نوع الملف — تحافظ على حقول كشف الحساب كما هي للتوافق. */
  private buildPreview(profile: ImportProfile, parsed: ParseResultJson, validation: any) {
    const base = {
      profile,
      format: parsed.format ?? 'xlsx',
      executable: validation.executable,
      deferredReason: validation.deferredReason ?? null,
      parserErrors: parsed.errors.length,
      ruleErrors: validation.ruleErrors.length,
      parserErrorDetails: parsed.errors,
      ruleErrorDetails: validation.ruleErrors,
      sampleAccounts: [],
      sampleCustomers: [],
      sampleBalances: [],
      sampleAgingRows: [],
    };

    if (profile === 'CUSTOMER_STATEMENT_DETAILS') {
      return {
        ...base,
        accountsInFile: parsed.stats.accounts,
        customersInFile: parsed.stats.customers,
        transactionsInFile: parsed.stats.transactions,
        fragmentedAccountsMerged: parsed.stats.fragmented_accounts,
        importableAccounts: validation.importable.accounts,
        importableTransactions: validation.importable.transactions,
        sampleAccounts: parsed.accounts.slice(0, 5).map((a) => ({
          customerCode: a.customerCode,
          customerName: a.customerName,
          currency: a.currency,
          computedBalance: a.computedBalance,
          declaredBalance: a.declaredBalance,
          transactions: a.transactions.length,
        })),
      };
    }
    if (profile === 'CUSTOMER_MASTER') {
      return {
        ...base,
        customersInFile: parsed.customers.length,
        importableCustomers: validation.importable.customers,
        sampleCustomers: parsed.customers.slice(0, 10),
      };
    }
    if (profile === 'CUSTOMER_BALANCE_SUMMARY') {
      return {
        ...base,
        customersInFile: new Set(parsed.balances.map((b) => b.customerCode)).size,
        balancesInFile: parsed.balances.length,
        currenciesInFile: [...new Set(parsed.balances.map((b) => b.currency))],
        importableBalances: validation.importable.balances,
        sampleBalances: parsed.balances.slice(0, 10),
      };
    }
    const rows = profile === 'DEBT_AGING_SUMMARY' ? parsed.agingSummary : parsed.agingDetails;
    return {
      ...base,
      customersInFile: profile === 'DEBT_AGING_DETAILS'
        ? new Set(rows.map((r) => r.customerCode)).size
        : 0,
      agingRowsInFile: rows.length,
      currenciesInFile: [...new Set(rows.map((r) => r.currency))],
      sampleAgingRows: rows.slice(0, 10),
      agingRowsWritten: 0,
      agingDocumentsWritten: 0,
      skippedDuplicates: 0,
      errors: parsed.errors.length + validation.ruleErrors.length,
    };
  }

  // --------------------------------------------------------------------------
  // المرحلة 5+6: تنفيذ الاستيراد + التقرير النهائي
  // --------------------------------------------------------------------------
  async execute(actor: AuthUser, jobId: string, force: boolean, req?: Request) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organizationId: actor.organizationId },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    if (job.status === 'completed') {
      throw new ConflictException('هذه العملية نُفذت مسبقًا — ارفع الملف من جديد لعملية جديدة');
    }
    if (job.status !== 'dry_run') {
      throw new ConflictException(`لا يمكن تنفيذ عملية بحالة ${job.status}`);
    }

    const report = job.errorReport as any;
    const profile: ImportProfile = report?.profile ?? 'CUSTOMER_STATEMENT_DETAILS';

    const previous = await this.prisma.importJob.findFirst({
      where: {
        organizationId: actor.organizationId, fileHash: job.fileHash,
        status: 'completed', id: { not: jobId },
      },
    });
    if (previous && !force) {
      throw new ConflictException(
        'الملف نفسه استورد سابقًا. إعادة التنفيذ آمنة (لن تتكرر بيانات) — أرسل force=true للتأكيد',
      );
    }

    try {
      const parsed: ParseResultJson = JSON.parse(await fs.readFile(report.parsedPath, 'utf-8'));
      const rollbackState = await this.captureRollbackBefore(actor, jobId, profile, parsed);
      const started = Date.now();
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'running', rollbackState: rollbackState as Prisma.InputJsonValue },
      });
      let result: {
        customersNew: number; customersUpdated: number;
        txnsInserted: number; txnsSkipped: number;
        executeErrors: { account: string; message: string }[];
        dupPairs: number; reconciliations: number;
        totalsBefore: Record<string, number>; totalsAfter: Record<string, number>;
        balancesWritten?: number;
        agingRowsWritten?: number;
        agingDocumentsWritten?: number;
        agingSkippedDuplicate?: number;
      };
      if (profile === 'CUSTOMER_MASTER') {
        result = await this.applyCustomerMaster(actor, jobId, parsed);
      } else if (profile === 'CUSTOMER_BALANCE_SUMMARY') {
        result = await this.applyBalanceSummary(actor, jobId, parsed);
      } else if (profile === 'DEBT_AGING_SUMMARY') {
        result = await this.applyAgingSummary(actor, jobId, parsed, job.fileHash);
      } else if (profile === 'DEBT_AGING_DETAILS') {
        result = await this.applyAgingDetails(actor, jobId, parsed, job.fileHash);
      } else {
        result = await this.applyImport(actor, jobId, parsed, report.ruleErrors ?? []);
      }
      const durationMs = Date.now() - started;
      const rollbackStateComplete = await this.captureRollbackAfter(actor, jobId, rollbackState);

      const updated = await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          importedAt: new Date(),
          customersNew: result.customersNew,
          customersUpdated: result.customersUpdated,
          txnsInserted: result.txnsInserted,
          txnsSkippedDuplicate: result.txnsSkipped,
          agingRowsWritten: result.agingRowsWritten ?? null,
          agingDocumentsWritten: result.agingDocumentsWritten ?? null,
          agingSkippedDuplicate: result.agingSkippedDuplicate ?? null,
          totalBalanceBefore: result.totalsBefore as any,
          totalBalanceAfter: result.totalsAfter as any,
          rollbackState: rollbackStateComplete as Prisma.InputJsonValue,
          errorReport: {
            ...report,
            executeErrors: result.executeErrors,
            durationMs,
            duplicateNamePairsFlagged: result.dupPairs,
            reconciliationsOpened: result.reconciliations,
            balancesWritten: result.balancesWritten ?? null,
          } as any,
        },
      });

      await this.audit.log({
        userId: actor.id, action: 'import_executed', entityTable: 'import_jobs', entityId: jobId,
        newValue: {
          forcedDuplicateImport: Boolean(previous && force),
          previousImportJobId: previous?.id ?? null,
          customersNew: result.customersNew, customersUpdated: result.customersUpdated,
          txnsInserted: result.txnsInserted, txnsSkipped: result.txnsSkipped,
          agingRowsWritten: result.agingRowsWritten ?? 0,
          agingDocumentsWritten: result.agingDocumentsWritten ?? 0,
          durationMs,
        }, req,
      });

      await this.riskRefresh?.trigger(
        actor,
        (rollbackStateComplete.after.customers as Array<{ id: string }>).map((customer) => customer.id),
        'import_completed',
        req,
      );

      return this.buildReport(updated);
    } catch (e) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorReport: { ...report, fatal: e instanceof Error ? e.message : String(e) } as any,
        },
      });
      this.logger.error(`فشل تنفيذ الاستيراد ${jobId}`, e instanceof Error ? e.stack : String(e));
      throw new BadRequestException('فشل تنفيذ الاستيراد — راجع /imports/{id}/errors. إعادة التنفيذ آمنة');
    }
  }

  /** قواعد الاستيراد المعتمدة — كتابة القاعدة. Idempotent بالكامل بحكم line_hash وقيود الفريدة. */
  private async applyImport(
    actor: AuthUser,
    jobId: string,
    parsed: ParseResultJson,
    _ruleErrors: any[],
  ) {
    const executeErrors: { account: string; message: string }[] = [];
    const knownCurrencies = new Set(
      (await this.prisma.currency.findMany({ where: { active: true } })).map((c) => c.code),
    );

    // أنواع المستندات: الموجود يُستخدم، والجديد يُنشأ آليًا بعلامة مراجعة (لا توقف)
    const docTypes = new Map(
      (await this.prisma.documentType.findMany({
        where: { organizationId: actor.organizationId },
      })).map((d) => [d.name, d.id]),
    );
    const allDocTypeNames = new Set<string>();
    for (const acc of parsed.accounts) {
      for (const t of acc.transactions) allDocTypeNames.add(t.docType);
    }
    for (const name of allDocTypeNames) {
      if (!docTypes.has(name)) {
        const created = await this.prisma.documentType.create({
          data: {
            organizationId: actor.organizationId, name, effect: 'mixed',
            notes: 'أُنشئ تلقائيًا أثناء الاستيراد — يحتاج مراجعة الأثر المحاسبي',
          },
        });
        docTypes.set(name, created.id);
      }
    }

    const totalsBefore = await this.balanceTotals(actor.organizationId);

    let customersNew = 0;
    let customersUpdated = 0;
    let txnsInserted = 0;
    let txnsSkipped = 0;
    let reconciliations = 0;

    // هل توجد قيود دفتر تشغيلي أصلاً؟ (لتفعيل التسوية عند وجود تحصيلات مسجلة)
    const ledgerExists = (await this.prisma.operationalLedger.count()) > 0;

    const seenCustomerIds = new Map<string, string>(); // code -> id

    for (const acc of parsed.accounts) {
      try {
        if (!acc.customerCode || acc.customerCode === 'None') continue; // سُجل في المعاينة
        if (!knownCurrencies.has(acc.currency)) continue;               // سُجل في المعاينة

        // ---- منع تكرار العملاء: upsert على (org, code) ----
        let customerId = seenCustomerIds.get(acc.customerCode);
        if (!customerId) {
          const existing = await this.prisma.customer.findUnique({
            where: {
              organizationId_externalCustomerCode: {
                organizationId: actor.organizationId,
                externalCustomerCode: acc.customerCode,
              },
            },
          });
          // نوع محلي محدد صراحةً (string لا string|undefined): كلا فرعي
          // if/else يعيّنانه قطعًا، فيتحقق التخصيص النهائي بلا لبس لـ TS
          // (خطأ TS2345 المُبلَّغ عنه كان بسبب الاعتماد على تضييق نوع
          // customerId نفسه عبر الفرعين المتداخلين).
          let resolvedId: string;
          if (existing) {
            resolvedId = existing.id;
            customersUpdated += 1;
            if (existing.name !== acc.customerName || existing.status === 'import_reversed') {
              await this.prisma.customer.update({
                where: { id: existing.id },
                data: {
                  name: acc.customerName,
                  nameNormalized: normalizeName(acc.customerName),
                  ...(existing.status === 'import_reversed' ? { status: 'active' } : {}),
                  updatedAt: new Date(),
                },
              });
            }
          } else {
            const created = await this.prisma.customer.create({
              data: {
                organizationId: actor.organizationId,
                externalCustomerCode: acc.customerCode,
                name: acc.customerName,
                nameNormalized: normalizeName(acc.customerName),
                createdByImportJob: jobId,
              },
            });
            resolvedId = created.id;
            customersNew += 1;
          }
          customerId = resolvedId;
          seenCustomerIds.set(acc.customerCode, resolvedId);
        }

        // ---- الحركات: منع التكرار بقيد line_hash الفريد + skipDuplicates ----
        for (let i = 0; i < acc.transactions.length; i += CHUNK) {
          const chunk = acc.transactions.slice(i, i + CHUNK);
          const res = await this.prisma.importedTransaction.createMany({
            data: chunk.map((t) => ({
              customerId: customerId!,
              currencyCode: acc.currency,
              documentTypeId: docTypes.get(t.docType)!,
              txDate: new Date(t.date),
              documentNumber: t.docNumber,
              description: t.description,
              referenceNumber: t.reference,
              debit: t.debit,
              credit: t.credit,
              lineHash: t.lineHash,
              sourceRowNumber: t.rowNumber,
              importJobId: jobId,
            })),
            skipDuplicates: true,
          });
          txnsInserted += res.count;
          txnsSkipped += chunk.length - res.count;
        }

        // ---- التسوية (قبل تحديث الرصيد): تُفتح فقط إذا وُجدت قيود تشغيلية منذ آخر استيراد ----
        const prevBalance = await this.prisma.customerBalance.findUnique({
          where: { customerId_currencyCode: { customerId, currencyCode: acc.currency } },
          include: { lastImportJob: { select: { importedAt: true } } },
        });
        if (ledgerExists && prevBalance?.lastImportJob) {
          const ledgerSum = await this.prisma.operationalLedger.aggregate({
            _sum: { amountSigned: true },
            where: {
              customerId, currencyCode: acc.currency,
              createdAt: { gt: prevBalance.lastImportJob.importedAt },
            },
          });
          const ledgerDelta = Number(ledgerSum._sum.amountSigned ?? 0);
          if (ledgerDelta !== 0) {
            const operational = Number(prevBalance.accountingBalance) + ledgerDelta;
            const difference = acc.computedBalance - operational;
            await this.prisma.balanceReconciliation.upsert({
              where: {
                customerId_currencyCode_importJobId: {
                  customerId, currencyCode: acc.currency, importJobId: jobId,
                },
              },
              update: {},
              create: {
                customerId, currencyCode: acc.currency, importJobId: jobId,
                accountingBalance: acc.computedBalance,
                operationalBalance: operational,
                difference,
                reviewStatus: difference === 0 ? 'approved' : 'pending',
              },
            });
            reconciliations += 1;
          }
        }

        // ---- الرصيد حسب العملة: upsert على القيد الفريد (customer, currency) ----
        await this.prisma.customerBalance.upsert({
          where: { customerId_currencyCode: { customerId, currencyCode: acc.currency } },
          update: {
            openingDebit: acc.openingDebit,
            openingCredit: acc.openingCredit,
            accountingBalance: acc.computedBalance,
            declaredBalance: acc.declaredBalance,
            declaredLabel: acc.declaredLabel,
            lastImportJobId: jobId,
            updatedAt: new Date(),
          },
          create: {
            customerId,
            currencyCode: acc.currency,
            openingDebit: acc.openingDebit,
            openingCredit: acc.openingCredit,
            accountingBalance: acc.computedBalance,
            declaredBalance: acc.declaredBalance,
            declaredLabel: acc.declaredLabel,
            lastImportJobId: jobId,
          },
        });

        // ---- Snapshot تاريخي لكل استيراد ----
        await this.prisma.balanceSnapshot.create({
          data: {
            customerId, currencyCode: acc.currency,
            balance: acc.computedBalance, importJobId: jobId,
          },
        });
      } catch (e) {
        // خطأ في حساب واحد لا يوقف البقية — يُسجَّل ويُتابع (متطلب صريح)
        executeErrors.push({
          account: `${acc.customerCode}/${acc.currency}`,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ---- كشف تشابه الأسماء (تنبيه فقط — لا دمج تلقائي أبدًا) ----
    let dupPairs = 0;
    const dupGroups = await this.prisma.customer.groupBy({
      by: ['nameNormalized'],
      where: { organizationId: actor.organizationId },
      having: { nameNormalized: { _count: { gt: 1 } } },
      _count: true,
    });
    for (const g of dupGroups) {
      const members = await this.prisma.customer.findMany({
        where: { organizationId: actor.organizationId, nameNormalized: g.nameNormalized },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      for (let a = 0; a < members.length; a += 1) {
        for (let b = a + 1; b < members.length; b += 1) {
          await this.prisma.potentialDuplicateCustomer.upsert({
            where: {
              customerAId_customerBId: {
                customerAId: members[a].id, customerBId: members[b].id,
              },
            },
            update: {},
            create: {
              customerAId: members[a].id,
              customerBId: members[b].id,
              matchReason: 'تطابق اسم تام بعد التطبيع مع اختلاف الكود',
            },
          });
          dupPairs += 1;
        }
      }
    }

    const totalsAfter = await this.balanceTotals(actor.organizationId);
    return {
      customersNew, customersUpdated, txnsInserted, txnsSkipped,
      executeErrors, dupPairs, reconciliations, totalsBefore, totalsAfter,
    };
  }

  /** استيراد بيانات العملاء الأساسية (CUSTOMER_MASTER) — upsert على (org, code). */
  private async applyCustomerMaster(actor: AuthUser, jobId: string, parsed: ParseResultJson) {
    const executeErrors: { account: string; message: string }[] = [];
    let customersNew = 0;
    let customersUpdated = 0;
    const seenCustomerIds = new Map<string, string>(); // code -> id

    for (const row of parsed.customers) {
      try {
        if (!row.customerCode || row.customerCode === 'None' || !row.customerName) {
          continue; // سُجل في المعاينة
        }
        let customerId = seenCustomerIds.get(row.customerCode);
        if (!customerId) {
          const existing = await this.prisma.customer.findUnique({
            where: {
              organizationId_externalCustomerCode: {
                organizationId: actor.organizationId,
                externalCustomerCode: row.customerCode,
              },
            },
          });
          let resolvedId: string;
          if (existing) {
            resolvedId = existing.id;
            customersUpdated += 1;
            const updates: Record<string, unknown> = {};
            if (existing.status === 'import_reversed') updates.status = 'active';
            if (existing.name !== row.customerName) {
              updates.name = row.customerName;
              updates.nameNormalized = normalizeName(row.customerName);
            }
            if (row.accountNumber && existing.accountNumber !== row.accountNumber) {
              updates.accountNumber = row.accountNumber;
            }
            if (row.phone && existing.phonePrimary !== row.phone) {
              updates.phonePrimary = row.phone;
            }
            if (row.whatsapp && existing.whatsapp !== row.whatsapp) {
              updates.whatsapp = row.whatsapp;
            }
            if (row.region && existing.region !== row.region) {
              updates.region = row.region;
            }
            if (row.address && existing.address !== row.address) {
              updates.address = row.address;
            }
            if (row.customerType && existing.customerType !== row.customerType) {
              updates.customerType = row.customerType;
            }
            if (Object.keys(updates).length) {
              updates.updatedAt = new Date();
              await this.prisma.customer.update({ where: { id: existing.id }, data: updates });
            }
          } else {
            const created = await this.prisma.customer.create({
              data: {
                organizationId: actor.organizationId,
                externalCustomerCode: row.customerCode,
                accountNumber: row.accountNumber ?? undefined,
                name: row.customerName,
                nameNormalized: normalizeName(row.customerName),
                phonePrimary: row.phone ?? undefined,
                whatsapp: row.whatsapp ?? undefined,
                region: row.region ?? undefined,
                address: row.address ?? undefined,
                customerType: row.customerType ?? undefined,
                createdByImportJob: jobId,
              },
            });
            resolvedId = created.id;
            customersNew += 1;
          }
          customerId = resolvedId;
          seenCustomerIds.set(row.customerCode, resolvedId);
        }
      } catch (e) {
        executeErrors.push({
          account: row.customerCode,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      customersNew, customersUpdated, txnsInserted: 0, txnsSkipped: 0,
      executeErrors, dupPairs: 0, reconciliations: 0,
      totalsBefore: {}, totalsAfter: {},
    };
  }

  /** استيراد ملخص أرصدة العملاء (CUSTOMER_BALANCE_SUMMARY) — رصيد الملف هو المرجع. */
  private async applyBalanceSummary(actor: AuthUser, jobId: string, parsed: ParseResultJson) {
    const executeErrors: { account: string; message: string }[] = [];
    const knownCurrencies = new Set(
      (await this.prisma.currency.findMany({ where: { active: true } })).map((c) => c.code),
    );
    const totalsBefore = await this.balanceTotals(actor.organizationId);
    let customersNew = 0;
    let customersUpdated = 0;
    let balancesWritten = 0;
    const seenCustomerIds = new Map<string, string>(); // code -> id

    for (const row of parsed.balances) {
      try {
        if (!row.customerCode || row.customerCode === 'None') continue; // سُجل في المعاينة
        if (!knownCurrencies.has(row.currency)) continue;               // سُجل في المعاينة
        if (row.balance == null) continue;                              // سُجل في المعاينة

        // ---- العملاء: upsert على (org, code) ----
        let customerId = seenCustomerIds.get(row.customerCode);
        if (!customerId) {
          const existing = await this.prisma.customer.findUnique({
            where: {
              organizationId_externalCustomerCode: {
                organizationId: actor.organizationId,
                externalCustomerCode: row.customerCode,
              },
            },
          });
          if (existing) {
            customerId = existing.id;
            customersUpdated += 1;
            if (existing.status === 'import_reversed') {
              await this.prisma.customer.update({
                where: { id: existing.id },
                data: { status: 'active', updatedAt: new Date() },
              });
            }
          } else {
            const created = await this.prisma.customer.create({
              data: {
                organizationId: actor.organizationId,
                externalCustomerCode: row.customerCode,
                name: row.customerName,
                nameNormalized: normalizeName(row.customerName),
                createdByImportJob: jobId,
              },
            });
            customerId = created.id;
            customersNew += 1;
          }
          seenCustomerIds.set(row.customerCode, customerId);
        }

        // ---- الرصيد حسب العملة: رصيد الملف هو المرجع المعتمد ----
        const openingDebit = row.openingBalance != null && row.openingBalance >= 0
          ? row.openingBalance : 0;
        const openingCredit = row.openingBalance != null && row.openingBalance < 0
          ? -row.openingBalance : 0;
        await this.prisma.customerBalance.upsert({
          where: { customerId_currencyCode: { customerId, currencyCode: row.currency } },
          update: {
            openingDebit,
            openingCredit,
            accountingBalance: row.balance,
            declaredBalance: row.balance,
            declaredLabel: 'رصيد الملف الحالي',
            lastImportJobId: jobId,
            updatedAt: new Date(),
          },
          create: {
            customerId,
            currencyCode: row.currency,
            openingDebit,
            openingCredit,
            accountingBalance: row.balance,
            declaredBalance: row.balance,
            declaredLabel: 'رصيد الملف الحالي',
            lastImportJobId: jobId,
          },
        });
        await this.prisma.balanceSnapshot.create({
          data: {
            customerId, currencyCode: row.currency, balance: row.balance, importJobId: jobId,
          },
        });
        balancesWritten += 1;
      } catch (e) {
        executeErrors.push({
          account: `${row.customerCode}/${row.currency}`,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const totalsAfter = await this.balanceTotals(actor.organizationId);
    return {
      customersNew, customersUpdated, txnsInserted: 0, txnsSkipped: 0, balancesWritten,
      executeErrors, dupPairs: 0, reconciliations: 0, totalsBefore, totalsAfter,
    };
  }

  /** استيراد تقسيم الأعمار المجمّع (DEBT_AGING_SUMMARY) — سطر لكل عميل/عملة. */
  private async applyAgingSummary(actor: AuthUser, jobId: string, parsed: ParseResultJson, fileHash: string) {
    const executeErrors: { account: string; message: string }[] = [];
    const knownCurrencies = new Set(
      (await this.prisma.currency.findMany({ where: { active: true } })).map((c) => c.code),
    );
    const counts = { customersNew: 0, customersUpdated: 0 };
    const seenCustomerIds = new Map<string, string>();
    let agingRowsWritten = 0;
    let skipped = 0;

    for (const row of parsed.agingSummary) {
      try {
        if (!row.customerCode || row.customerCode === 'None') continue; // سُجل في المعاينة
        if (!knownCurrencies.has(row.currency)) continue;               // سُجل في المعاينة

        const customerId = await this.upsertAgingCustomer(
          actor, jobId, row.customerCode, row.customerName ?? row.customerCode,
          seenCustomerIds, counts,
        );
        const lineHash = this.agingLineHash(
          'DEBT_AGING_SUMMARY', fileHash, row.customerCode, row.currency, row.rowNumber,
        );
        if (await this.prisma.debtAgingSummary.findFirst({ where: { lineHash, reversedAt: null } })) {
          skipped += 1;
          continue;
        }
        await this.prisma.debtAgingSummary.create({
          data: {
            importJobId: jobId,
            customerId,
            customerCode: row.customerCode,
            currencyCode: row.currency,
            bucket_0_30: row.buckets['0-30'] ?? 0,
            bucket_31_60: row.buckets['31-60'] ?? 0,
            bucket_61_90: row.buckets['61-90'] ?? 0,
            bucket_91_120: row.buckets['91-120'] ?? 0,
            bucket_120_plus: row.buckets['120+'] ?? 0,
            totalDue: row.total ?? this.sumAgingBuckets(row.buckets),
            sourceRowNumber: row.rowNumber,
            lineHash,
          },
        });
        agingRowsWritten += 1;
      } catch (e) {
        executeErrors.push({
          account: `${row.customerCode ?? '?'}/${row.currency}`,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      customersNew: counts.customersNew,
      customersUpdated: counts.customersUpdated,
      txnsInserted: 0,
      txnsSkipped: skipped,
      agingRowsWritten,
      agingDocumentsWritten: 0,
      agingSkippedDuplicate: skipped,
      executeErrors,
      dupPairs: 0,
      reconciliations: 0,
      totalsBefore: {},
      totalsAfter: {},
    };
  }

  /** استيراد تقسيم الأعمار التفصيلي (DEBT_AGING_DETAILS) — سطر لكل مستند. */
  private async applyAgingDetails(actor: AuthUser, jobId: string, parsed: ParseResultJson, fileHash: string) {
    const executeErrors: { account: string; message: string }[] = [];
    const knownCurrencies = new Set(
      (await this.prisma.currency.findMany({ where: { active: true } })).map((c) => c.code),
    );
    const counts = { customersNew: 0, customersUpdated: 0 };
    const seenCustomerIds = new Map<string, string>();
    let agingDocumentsWritten = 0;
    let skipped = 0;

    for (const row of parsed.agingDetails) {
      try {
        if (!row.customerCode || row.customerCode === 'None') continue; // سُجل في المعاينة
        if (!knownCurrencies.has(row.currency)) continue;               // سُجل في المعاينة

        const customerId = await this.upsertAgingCustomer(
          actor, jobId, row.customerCode, row.customerName ?? row.customerCode,
          seenCustomerIds, counts,
        );
        const lineHash = this.agingLineHash(
          'DEBT_AGING_DETAILS', fileHash, row.customerCode, row.currency, row.rowNumber,
          row.documentNumber, row.documentDate,
        );
        if (await this.prisma.debtAgingDetail.findFirst({ where: { lineHash, reversedAt: null } })) {
          skipped += 1;
          continue;
        }
        await this.prisma.debtAgingDetail.create({
          data: {
            importJobId: jobId,
            customerId,
            customerCode: row.customerCode,
            currencyCode: row.currency,
            documentNumber: row.documentNumber ?? null,
            documentDate: this.parseAgingDate(row.documentDate),
            documentType: row.documentType ?? null,
            amount: row.total ?? this.sumAgingBuckets(row.buckets),
            bucket_0_30: row.buckets['0-30'] ?? 0,
            bucket_31_60: row.buckets['31-60'] ?? 0,
            bucket_61_90: row.buckets['61-90'] ?? 0,
            bucket_91_120: row.buckets['91-120'] ?? 0,
            bucket_120_plus: row.buckets['120+'] ?? 0,
            sourceRowNumber: row.rowNumber,
            lineHash,
          },
        });
        agingDocumentsWritten += 1;
      } catch (e) {
        executeErrors.push({
          account: `${row.customerCode ?? '?'}/${row.currency}`,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      customersNew: counts.customersNew,
      customersUpdated: counts.customersUpdated,
      txnsInserted: 0,
      txnsSkipped: skipped,
      agingRowsWritten: 0,
      agingDocumentsWritten,
      agingSkippedDuplicate: skipped,
      executeErrors,
      dupPairs: 0,
      reconciliations: 0,
      totalsBefore: {},
      totalsAfter: {},
    };
  }

  /**
   * هاش سطر أعمار — يعتمد على هوية الملف (fileHash) حتى لا تُمنع ملفات الأشهر
   * الجديدة بسبب نفس rowNumber، ومع ذلك يعيد نفس الملف → نفس الهاش → skipped.
   * لملف التفاصيل يضاف documentNumber/documentDate إن وُجدا (أقل تكرارًا داخل الملف).
   */
  private agingLineHash(
    profile: ImportProfile, fileHash: string, code: string, currency: string,
    rowNumber: number, docNumber?: string | null, docDate?: string | null,
  ): string {
    return createHash('sha256')
      .update(`${profile}|${fileHash}|${code}|${currency}|${rowNumber}|${docNumber ?? ''}|${docDate ?? ''}`)
      .digest('hex');
  }

  /** مجموع فئات الأعمار — بديل آمن عند غياب/فشل عمود الإجمالي. */
  private sumAgingBuckets(buckets: Record<string, number>): number {
    return AGING_BUCKET_KEYS.reduce((sum, k) => sum + (buckets[k] ?? 0), 0);
  }

  /** تحويل تاريخ المستند (DD/MM/YYYY أو YYYY/MM/DD وبفواصل / أو - أو .) — null عند الغموض. */
  private parseAgingDate(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const m = String(raw).trim().match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
    if (!m) return null;
    const date = m[1].length === 4
      ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      : new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** عميل (org, code) — نفس سياسة upsert لبقية الملفات: موجود يُحَّد اسمه، غائب يُنشأ. */
  private async upsertAgingCustomer(
    actor: AuthUser,
    jobId: string,
    code: string,
    name: string,
    seen: Map<string, string>,
    counts: { customersNew: number; customersUpdated: number },
  ): Promise<string> {
    let customerId = seen.get(code);
    if (customerId) return customerId;
    const existing = await this.prisma.customer.findUnique({
      where: {
        organizationId_externalCustomerCode: {
          organizationId: actor.organizationId,
          externalCustomerCode: code,
        },
      },
    });
    if (existing) {
      customerId = existing.id;
      counts.customersUpdated += 1;
      if (existing.name !== name || existing.status === 'import_reversed') {
        await this.prisma.customer.update({
          where: { id: existing.id },
          data: {
            name,
            nameNormalized: normalizeName(name),
            ...(existing.status === 'import_reversed' ? { status: 'active' } : {}),
            updatedAt: new Date(),
          },
        });
      }
    } else {
      const created = await this.prisma.customer.create({
        data: {
          organizationId: actor.organizationId,
          externalCustomerCode: code,
          name,
          nameNormalized: normalizeName(name),
          createdByImportJob: jobId,
        },
      });
      customerId = created.id;
      counts.customersNew += 1;
    }
    seen.set(code, customerId);
    return customerId;
  }

  private async balanceTotals(orgId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.customerBalance.groupBy({
      by: ['currencyCode'],
      where: { customer: { organizationId: orgId } },
      _sum: { accountingBalance: true },
    });
    return Object.fromEntries(
      rows.map((r) => [r.currencyCode, Number(r._sum.accountingBalance ?? 0)]),
    );
  }

  private customerSnapshot(customer: any) {
    return {
      id: customer.id,
      externalCustomerCode: customer.externalCustomerCode,
      name: customer.name,
      nameNormalized: customer.nameNormalized,
      accountNumber: customer.accountNumber,
      phonePrimary: customer.phonePrimary,
      whatsapp: customer.whatsapp,
      region: customer.region,
      address: customer.address,
      customerType: customer.customerType,
      status: customer.status,
    };
  }

  private balanceSnapshotState(balance: any, customerCode: string) {
    return {
      id: balance.id,
      customerCode,
      customerId: balance.customerId,
      currencyCode: balance.currencyCode,
      openingDebit: balance.openingDebit.toString(),
      openingCredit: balance.openingCredit.toString(),
      accountingBalance: balance.accountingBalance.toString(),
      declaredBalance: balance.declaredBalance?.toString() ?? null,
      declaredLabel: balance.declaredLabel,
      lastImportJobId: balance.lastImportJobId,
    };
  }

  private snapshotEquals(current: Record<string, unknown>, expected: Record<string, unknown>) {
    return Object.keys(expected).every((key) => {
      const left = current[key] ?? null;
      const right = expected[key] ?? null;
      return String(left) === String(right);
    });
  }

  private rollbackTargets(profile: ImportProfile, parsed: ParseResultJson) {
    const codes = new Set<string>();
    const currencyByCode = new Map<string, Set<string>>();
    const add = (code: string | null | undefined, currency?: string | null) => {
      if (!code || code === 'None') return;
      codes.add(code);
      if (currency) {
        const currencies = currencyByCode.get(code) ?? new Set<string>();
        currencies.add(currency);
        currencyByCode.set(code, currencies);
      }
    };
    if (profile === 'CUSTOMER_STATEMENT_DETAILS') {
      for (const row of parsed.accounts) add(row.customerCode, row.currency);
    } else if (profile === 'CUSTOMER_BALANCE_SUMMARY') {
      for (const row of parsed.balances) add(row.customerCode, row.currency);
    } else if (profile === 'CUSTOMER_MASTER') {
      for (const row of parsed.customers) add(row.customerCode);
    } else if (profile === 'DEBT_AGING_SUMMARY') {
      for (const row of parsed.agingSummary) add(row.customerCode);
    } else if (profile === 'DEBT_AGING_DETAILS') {
      for (const row of parsed.agingDetails) add(row.customerCode);
    }
    return {
      codes: [...codes],
      currencyByCode: Object.fromEntries(
        [...currencyByCode.entries()].map(([code, currencies]) => [code, [...currencies]]),
      ),
    };
  }

  private async captureRollbackBefore(
    actor: AuthUser, jobId: string, profile: ImportProfile, parsed: ParseResultJson,
  ) {
    const targets = this.rollbackTargets(profile, parsed);
    const customers = await this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId, externalCustomerCode: { in: targets.codes } },
    });
    const codeById = new Map(customers.map((customer) => [customer.id, customer.externalCustomerCode]));
    const balanceOr = customers.flatMap((customer) =>
      (targets.currencyByCode[customer.externalCustomerCode] ?? []).map((currencyCode) => ({
        customerId: customer.id, currencyCode,
      })),
    );
    const balances = balanceOr.length
      ? await this.prisma.customerBalance.findMany({ where: { OR: balanceOr } })
      : [];
    return {
      version: 1,
      jobId,
      profile,
      targets,
      before: {
        customers: customers.map((customer) => this.customerSnapshot(customer)),
        balances: balances.map((balance) =>
          this.balanceSnapshotState(balance, codeById.get(balance.customerId)!),
        ),
      },
    };
  }

  private async captureRollbackAfter(actor: AuthUser, jobId: string, state: any) {
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: actor.organizationId,
        externalCustomerCode: { in: state.targets.codes },
      },
    });
    const codeById = new Map(customers.map((customer) => [customer.id, customer.externalCustomerCode]));
    const balanceOr = customers.flatMap((customer) =>
      (state.targets.currencyByCode[customer.externalCustomerCode] ?? []).map((currencyCode: string) => ({
        customerId: customer.id, currencyCode,
      })),
    );
    const balances = balanceOr.length
      ? await this.prisma.customerBalance.findMany({ where: { OR: balanceOr } })
      : [];
    return {
      ...state,
      completedAt: new Date().toISOString(),
      after: {
        customers: customers.map((customer) => this.customerSnapshot(customer)),
        balances: balances.map((balance) =>
          this.balanceSnapshotState(balance, codeById.get(balance.customerId)!),
        ),
      },
    };
  }

  async reverse(actor: AuthUser, jobId: string, reason: string, req?: Request) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3) {
      throw new BadRequestException('سبب التراجع يجب أن يحتوي على 3 أحرف على الأقل');
    }
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.importJob.findFirst({
        where: { id: jobId, organizationId: actor.organizationId },
      });
      if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
      if (job.status === 'reversed') throw new ConflictException('تم التراجع عن هذه الدفعة مسبقًا');
      if (job.status !== 'completed') throw new ConflictException('لا يمكن التراجع إلا عن دفعة مكتملة');
      const state = job.rollbackState as any;
      if (!state?.version || !state?.after) {
        throw new ConflictException('هذه دفعة قديمة لا تحتوي لقطة استعادة؛ لا يمكن عكسها آليًا بأمان');
      }

      const latest = await tx.importJob.findFirst({
        where: { organizationId: actor.organizationId, status: 'completed' },
        orderBy: { importedAt: 'desc' },
        select: { id: true },
      });
      if (latest?.id !== jobId) {
        throw new ConflictException('يجب التراجع عن أحدث دفعة مكتملة أولًا للمحافظة على التسلسل المحاسبي');
      }

      const currentCustomers = await tx.customer.findMany({
        where: {
          organizationId: actor.organizationId,
          externalCustomerCode: { in: state.targets.codes },
        },
      });
      const currentByCode = new Map(
        currentCustomers.map((customer) => [customer.externalCustomerCode, customer]),
      );
      for (const expected of state.after.customers) {
        const current = currentByCode.get(expected.externalCustomerCode);
        if (!current || !this.snapshotEquals(this.customerSnapshot(current), expected)) {
          throw new ConflictException(
            `تغيرت بيانات العميل ${expected.externalCustomerCode} بعد الاستيراد؛ راجعها قبل التراجع`,
          );
        }
      }

      const expectedBalances = state.after.balances as any[];
      for (const expected of expectedBalances) {
        const customer = currentByCode.get(expected.customerCode);
        const current = customer
          ? await tx.customerBalance.findUnique({
              where: {
                customerId_currencyCode: {
                  customerId: customer.id, currencyCode: expected.currencyCode,
                },
              },
            })
          : null;
        if (!current
          || !this.snapshotEquals(this.balanceSnapshotState(current, expected.customerCode), expected)) {
          throw new ConflictException(
            `تغير رصيد ${expected.customerCode}/${expected.currencyCode} بعد الاستيراد؛ أوقف التراجع للمراجعة`,
          );
        }
      }

      const beforeCodes = new Set((state.before.customers as any[]).map((customer) => customer.externalCustomerCode));
      for (const customer of currentCustomers.filter((item) => !beforeCodes.has(item.externalCustomerCode))) {
        const activityCount = await Promise.all([
          tx.collection.count({ where: { customerId: customer.id } }),
          tx.paymentPromise.count({ where: { customerId: customer.id } }),
          tx.followup.count({ where: { customerId: customer.id } }),
          tx.task.count({ where: { customerId: customer.id } }),
          tx.reservation.count({ where: { customerId: customer.id } }),
          tx.operationalLedger.count({ where: { customerId: customer.id } }),
          tx.customerAssignment.count({ where: { customerId: customer.id } }),
          tx.customerCreditPolicy.count({ where: { customerId: customer.id } }),
        ]).then((counts) => counts.reduce((sum, count) => sum + count, 0));
        if (activityCount > 0) {
          throw new ConflictException(
            `العميل ${customer.externalCustomerCode} أُنشئ في الدفعة ثم حصل على نشاط تشغيلي؛ لا يمكن أرشفته تلقائيًا`,
          );
        }
      }

      const reversedAt = new Date();
      await Promise.all([
        tx.importedTransaction.updateMany({ where: { importJobId: jobId, reversedAt: null }, data: { reversedAt } }),
        tx.balanceSnapshot.updateMany({ where: { importJobId: jobId, reversedAt: null }, data: { reversedAt } }),
        tx.balanceReconciliation.updateMany({ where: { importJobId: jobId, reversedAt: null }, data: { reversedAt } }),
        tx.debtAgingSummary.updateMany({ where: { importJobId: jobId, reversedAt: null }, data: { reversedAt } }),
        tx.debtAgingDetail.updateMany({ where: { importJobId: jobId, reversedAt: null }, data: { reversedAt } }),
        tx.analyticalMovement.updateMany({ where: { sourceImportJobId: jobId, reversedAt: null }, data: { reversedAt } }),
      ]);

      for (const before of state.before.customers as any[]) {
        await tx.customer.update({
          where: { id: before.id },
          data: {
            name: before.name,
            nameNormalized: before.nameNormalized,
            accountNumber: before.accountNumber,
            phonePrimary: before.phonePrimary,
            whatsapp: before.whatsapp,
            region: before.region,
            address: before.address,
            customerType: before.customerType,
            status: before.status,
            updatedAt: new Date(),
          },
        });
      }
      await tx.customer.updateMany({
        where: {
          organizationId: actor.organizationId,
          createdByImportJob: jobId,
          externalCustomerCode: { notIn: [...beforeCodes] },
        },
        data: { status: 'import_reversed', updatedAt: new Date() },
      });

      const beforeBalanceKeys = new Set<string>();
      for (const before of state.before.balances as any[]) {
        beforeBalanceKeys.add(`${before.customerCode}|${before.currencyCode}`);
        await tx.customerBalance.update({
          where: { id: before.id },
          data: {
            openingDebit: new Prisma.Decimal(before.openingDebit),
            openingCredit: new Prisma.Decimal(before.openingCredit),
            accountingBalance: new Prisma.Decimal(before.accountingBalance),
            declaredBalance: before.declaredBalance == null ? null : new Prisma.Decimal(before.declaredBalance),
            declaredLabel: before.declaredLabel,
            lastImportJobId: before.lastImportJobId,
            updatedAt: new Date(),
          },
        });
      }
      for (const after of expectedBalances) {
        if (beforeBalanceKeys.has(`${after.customerCode}|${after.currencyCode}`)) continue;
        await tx.customerBalance.deleteMany({
          where: { id: after.id, lastImportJobId: jobId },
        });
      }

      const changed = await tx.importJob.updateMany({
        where: { id: jobId, status: 'completed', reversedAt: null },
        data: { status: 'reversed', reversedAt, reversedBy: actor.id, reversalReason: normalizedReason },
      });
      if (changed.count !== 1) throw new ConflictException('تم التراجع عن الدفعة بالتزامن من مستخدم آخر');
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'import_reversed',
          entityTable: 'import_jobs',
          entityId: jobId,
          oldValue: { status: 'completed' },
          newValue: { status: 'reversed', fileName: job.fileName },
          reason: normalizedReason,
          ipAddress: req?.ip ?? null,
          userAgent: (req?.headers['user-agent'] as string) ?? null,
        },
      });
      return {
        jobId,
        status: 'reversed',
        reversedAt,
        message: 'تم التراجع عن دفعة الاستيراد وحفظ سجلاتها كمُعكوسة دون حذف المصدر',
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
  }

  // --------------------------------------------------------------------------
  // الاستعلامات
  // --------------------------------------------------------------------------
  async findAll(actor: AuthUser) {
    const jobs = await this.prisma.importJob.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { importedAt: 'desc' },
      select: {
        id: true, fileName: true, status: true, importedAt: true,
        txnsInFile: true, txnsInserted: true, txnsSkippedDuplicate: true,
        customersNew: true, customersUpdated: true, errorsCount: true,
        agingRowsWritten: true, agingDocumentsWritten: true,
        rollbackState: true, reversedAt: true, reversalReason: true,
        errorReport: true,
        uploader: { select: { id: true, fullName: true } },
      },
    });
    const latestCompletedId = jobs.find((j: any) => j.status === 'completed')?.id ?? null;
    return jobs.map((j: any) => {
      const er = (j.errorReport ?? {}) as any;
      return {
        id: j.id, fileName: j.fileName, status: j.status, importedAt: j.importedAt,
        txnsInFile: j.txnsInFile, txnsInserted: j.txnsInserted,
        txnsSkippedDuplicate: j.txnsSkippedDuplicate, customersNew: j.customersNew,
        customersUpdated: j.customersUpdated, errorsCount: j.errorsCount,
        agingRowsWritten: j.agingRowsWritten ?? null,
        agingDocumentsWritten: j.agingDocumentsWritten ?? null,
        profile: er.profile ?? 'CUSTOMER_STATEMENT_DETAILS',
        executable: er.executable ?? true,
        canReverse: j.id === latestCompletedId && Boolean(j.rollbackState),
        reversedAt: j.reversedAt ?? null,
        reversalReason: j.reversalReason ?? null,
        uploader: j.uploader,
      };
    });
  }

  async findOne(actor: AuthUser, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { uploader: { select: { id: true, fullName: true } } },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    const { errorReport: _errorReport, rollbackState: _rollbackState, ...rest } = job as any;
    return rest;
  }

  async getReport(actor: AuthUser, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    return this.buildReport(job);
  }

  /** التقرير النهائي — كل العدادات التسعة المطلوبة + عدادات الأعمار (PR 3). */
  private buildReport(job: any) {
    const er = (job.errorReport ?? {}) as any;
    const profile = er.profile ?? 'CUSTOMER_STATEMENT_DETAILS';
    const parserErrors = (er.parserErrors ?? []).length;
    const ruleErrors = (er.ruleErrors ?? []).length;
    const executeErrors = (er.executeErrors ?? []).length;
    const rowsImported = profile === 'CUSTOMER_STATEMENT_DETAILS'
      ? job.txnsInserted
      : profile === 'DEBT_AGING_SUMMARY'
      ? (job.agingRowsWritten ?? 0)
      : profile === 'DEBT_AGING_DETAILS'
      ? (job.agingDocumentsWritten ?? 0)
      : (job.customersNew ?? 0) + (job.customersUpdated ?? 0);
    return {
      jobId: job.id,
      fileName: job.fileName,
      status: job.status,
      profile,
      importedAt: job.importedAt,
      rowsRead: job.rowsTotal,                                   // عدد الصفوف المقروءة
      rowsImported,                                              // المستوردة فعلاً
      rowsIgnored: (job.txnsSkippedDuplicate ?? 0) + parserErrors + ruleErrors, // المتجاهلة
      errorsCount: parserErrors + ruleErrors + executeErrors,    // الأخطاء
      errors: parserErrors + ruleErrors + executeErrors,         // PR 3: اسم موحد للعدّاد
      customersNew: job.customersNew,                            // العملاء الجدد
      customersUpdated: job.customersUpdated,                    // المحدثون
      transactionsNew: job.txnsInserted,                         // الحركات الجديدة
      transactionsDuplicate: job.txnsSkippedDuplicate,           // المكررة
      durationMs: er.durationMs ?? null,                         // الزمن المستغرق
      balancesBefore: job.totalBalanceBefore,
      balancesAfter: job.totalBalanceAfter,
      balancesWritten: er.balancesWritten ?? null,
      duplicateNamePairsFlagged: er.duplicateNamePairsFlagged ?? 0,
      reconciliationsOpened: er.reconciliationsOpened ?? 0,
      agingRowsWritten: job.agingRowsWritten ?? null,            // PR 3: أسطر الأعمار المجمّع
      agingDocumentsWritten: job.agingDocumentsWritten ?? null,  // PR 3: وثائق الأعمار التفصيلي
      skippedDuplicates: job.agingSkippedDuplicate ?? job.txnsSkippedDuplicate ?? 0,
    };
  }

  async getErrors(actor: AuthUser, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    const er = (job.errorReport ?? {}) as any;
    return {
      jobId: job.id,
      profile: er.profile ?? 'CUSTOMER_STATEMENT_DETAILS',
      executable: er.executable ?? true,
      deferredReason: er.deferredReason ?? null,
      parserErrors: er.parserErrors ?? [],     // صفوف تالفة (مدين+دائن معًا، سالب...)
      ruleErrors: er.ruleErrors ?? [],         // عملة غير معروفة، كود ناقص...
      executeErrors: er.executeErrors ?? [],   // أخطاء أثناء الكتابة (حساب-بحساب)
      accountWarnings: er.accountWarnings ?? [],
      fatal: er.fatal ?? null,
    };
  }
}
