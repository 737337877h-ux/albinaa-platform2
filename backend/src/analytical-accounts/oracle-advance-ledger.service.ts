import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { OracleAccountStatementReader } from '../customers/oracle-account-statement.reader';
import { OracleAdvanceReader } from './oracle-advance.reader';
import { ADVANCE_LEDGER_PROFILE, AdvanceStatement, AdvanceOpeningApproval, reconcileApprovedAdvanceOpening, validateAdvanceStatement } from './oracle-advance-ledger';

@Injectable()
export class OracleAdvanceLedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OracleAdvanceLedgerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly reader: OracleAdvanceReader,
    private readonly statements: OracleAccountStatementReader) {}

  onModuleInit() {
    // Only organizations that previously opted into the Oracle advance import are eligible.
    this.timer = setInterval(() => void this.refreshRegistered(), 300_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async refreshRegistered() {
    if (this.running || process.env.ORACLE_ADVANCE_SYNC_ENABLED === 'false'
      || process.env.ORACLE_READ_SCHEMA !== 'IAS20261') return;
    this.running = true;
    try {
      const jobs = await this.prisma.importJob.findMany({
        where: { status: 'completed', reversedAt: null, fileName: { startsWith: 'oracle-advances-IAS20261-' } },
        distinct: ['organizationId'], orderBy: { importedAt: 'desc' },
        select: { organizationId: true, uploadedBy: true },
      });
      for (const job of jobs) {
        const user = await this.prisma.user.findFirst({ where: { id: job.uploadedBy, organizationId: job.organizationId, isActive: true } });
        if (!user) continue;
        try {
          const result = await this.sync({ ...user, roles: [], permissions: [] }, false, true);
          this.logger.log(`Advance sync ${job.organizationId}: ${result.status}; updated=${result.balancesUpdated}; skipped=${result.issues.length}`);
          if (result.issues.length) this.logger.warn(JSON.stringify(result.issues));
        } catch (error) { this.logger.warn(`Advance sync ${job.organizationId} failed: ${error instanceof Error ? error.message : 'unknown'}`); }
      }
    } catch (error) { this.logger.warn(`Advance sync failed: ${error instanceof Error ? error.message : 'unknown'}`); }
    finally { this.running = false; }
  }

  async sync(actor: AuthUser, dryRun: boolean, existingOnly = false) {
    const snapshot = await this.reader.read();
    const approvalSetting = await this.prisma.systemSetting.findUnique({ where: { organizationId_key: {
      organizationId: actor.organizationId, key: 'oracle.advances.opening-approvals.IAS20261',
    } } });
    const approvals = (approvalSetting?.value ?? {}) as unknown as Record<string, AdvanceOpeningApproval>;
    const currencies = new Set((await this.prisma.currency.findMany({ where: { active: true }, select: { code: true } })).map(r => r.code));
    const existing = await this.prisma.customer.findMany({ where: { organizationId: actor.organizationId, customerType: 'advance', mergedIntoId: null }, include: { balances: true } });
    const groups = new Map<string, typeof snapshot.accounts>();
    for (const row of snapshot.accounts) groups.set(row.accountNumber, [...(groups.get(row.accountNumber) ?? []), row]);
    const issues: Array<{ accountNumber: string; currency?: string; reason: string }> = [];
    const result = { accountsCreated: 0, accountsUpdated: 0, balancesUpdated: 0, balancesCleared: 0, transactionsImported: 0, unchanged: 0 };
    const byCurrency: Record<string, { accounts: number; debtorAccounts: number; debtorBalance: number; creditorAccounts: number; creditorBalance: number; netBalance: number }> = {};
    for (const row of snapshot.accounts.filter(r => r.currencyCode)) {
      const total = byCurrency[row.currencyCode!] ??= { accounts: 0, debtorAccounts: 0, debtorBalance: 0, creditorAccounts: 0, creditorBalance: 0, netBalance: 0 };
      total.accounts++; total.netBalance += row.balance;
      if (row.balance > 0) { total.debtorAccounts++; total.debtorBalance += row.balance; }
      if (row.balance < 0) { total.creditorAccounts++; total.creditorBalance -= row.balance; }
    }
    for (const [accountNumber, rows] of groups) {
      const matches = existing.filter(c => c.accountNumber === accountNumber);
      if (existingOnly && !matches.length) continue;
      if (matches.length > 1 || new Set(rows.map(r => r.sourceAccountCode)).size !== 1 || rows.some(r => r.analyticalType !== 5)) {
        issues.push({ accountNumber, reason: 'Ambiguous Oracle account mapping' }); continue;
      }
      const customer = matches[0];
      const balances = rows.filter(r => r.currencyCode !== null).map(r => ({ currency: r.currencyCode!, balance: r.balance }));
      for (const stale of customer?.balances ?? []) {
        if (!balances.some(r => r.currency === stale.currencyCode) && Number(stale.accountingBalance) !== 0) {
          balances.push({ currency: stale.currencyCode as 'YER' | 'SAR' | 'USD', balance: 0 });
        }
      }
      if (new Set(balances.map(r => r.currency)).size !== balances.length) {
        issues.push({ accountNumber, reason: 'Duplicate Oracle currency mapping' }); continue;
      }
      for (const balance of balances) {
        try {
          if (!currencies.has(balance.currency)) throw new Error('Inactive platform currency');
          const sourceReport = await this.statements.read({ customerType: 'advance', externalCustomerCode: `ADV-${accountNumber}`, accountNumber }, {
            currency: balance.currency, fromDate: '2026-01-01', toDate: '2026-12-31', source: 'oracle_archive',
          });
          const report = reconcileApprovedAdvanceOpening(sourceReport, balance.balance, approvals[`${accountNumber}:${balance.currency}`]);
          const hash = validateAdvanceStatement(report, balance.balance);
          if (dryRun) continue;
          const saved = await this.publish(actor, accountNumber, rows[0].nameAr, rows[0].sourceAccountCode, report, hash);
          if (saved.unchanged) result.unchanged++;
          else {
            result.balancesUpdated++;
            result.transactionsImported += report.total;
            if (saved.created) result.accountsCreated++; else result.accountsUpdated++;
          }
        } catch (error) { issues.push({ accountNumber, currency: balance.currency, reason: error instanceof Error ? error.message : 'Read failed' }); }
      }
    }
    return { status: dryRun ? 'dry_run' : issues.length ? 'partial' : 'completed', ...result, issues,
      preview: { profile: ADVANCE_LEDGER_PROFILE, sourceSchema: snapshot.schema, sourceAccountCodes: ['113101001', '113101002'],
        sourceAccounts: groups.size, balanceRows: snapshot.accounts.filter(r => r.currencyCode).length, byCurrency,
        sampleAccounts: snapshot.accounts.slice(0, 12), readMode: 'SELECT_ONLY', oracleWrite: 'NONE', coverageStart: '2026-01-01' },
    };
  }

  async publish(actor: AuthUser, accountNumber: string, name: string, sourceAccount: string, report: AdvanceStatement, hash: string) {
    if (!/^\d{1,30}$/.test(accountNumber) || !['113101001', '113101002'].includes(sourceAccount)
      || validateAdvanceStatement(report, report.periodEndBalance) !== hash) throw new Error('Invalid advance publication');
    // Reading Oracle finishes before taking a platform lock. Never hold Oracle writes/locks.
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.organizationId}), hashtext(${`advance:${accountNumber}`}))::text AS locked`;
      const matches = await tx.customer.findMany({ where: { organizationId: actor.organizationId, customerType: 'advance', accountNumber, mergedIntoId: null } });
      if (matches.length > 1) throw new Error('Ambiguous platform advance account');
      let customer = matches[0];
      const created = !customer;
      const previousBalance = customer ? await tx.customerBalance.findUnique({ where: { customerId_currencyCode: { customerId: customer.id, currencyCode: report.currency } }, include: { lastImportJob: true } }) : null;
      const previous = customer ? await tx.importedTransaction.findMany({ where: { customerId: customer.id, currencyCode: report.currency, reversedAt: null }, include: { importJob: { select: { errorReport: true } } } }) : [];
      if (previous.some(row => (row.importJob.errorReport as any)?.profile !== ADVANCE_LEDGER_PROFILE)) {
        throw new Error('Existing manually imported movements require reconciliation; preserved unchanged');
      }
      if (customer && await tx.operationalLedger.count({ where: { customerId: customer.id, currencyCode: report.currency,
        ...(previousBalance?.lastImportJob ? { createdAt: { gt: previousBalance.lastImportJob.importedAt } } : {}) } })) {
        throw new Error('Pending platform ledger entries require reconciliation; preserved unchanged');
      }
      // The snapshot read must not overwrite a newer publication from another worker.
      if (previousBalance?.lastImportJob && (previousBalance.lastImportJob.errorReport as any)?.readAt > report.readAt) return { unchanged: true, created: false };
      if (previousBalance?.lastImportJob?.fileHash === hash && previous.length === report.total
        && Number(previousBalance.accountingBalance) === report.periodEndBalance
        && Number(previousBalance.openingDebit) - Number(previousBalance.openingCredit) === report.openingBalance) {
        return { unchanged: true, created: false };
      }
      const job = await tx.importJob.create({ data: {
        organizationId: actor.organizationId, uploadedBy: actor.id,
        fileName: `oracle-advances-IAS20261-${accountNumber}-${report.currency}-${Date.now()}.json`, fileHash: hash,
        status: 'completed', rowsTotal: report.total, txnsInFile: report.total, txnsInserted: report.total,
        errorsCount: 0, customersNew: created ? 1 : 0, customersUpdated: created ? 0 : 1,
        errorReport: { profile: ADVANCE_LEDGER_PROFILE, schema: 'IAS20261', sourceAccount, accountNumber,
          currency: report.currency, readAt: report.readAt, coverageStart: '2026-01-01', coverageEnd: '2026-12-31', oracleWrite: 'NONE',
          ...(report.openingReconciliation ? { openingReconciliation: { ...report.openingReconciliation } } : {}) },
        rollbackState: JSON.parse(JSON.stringify({ balance: previousBalance ? { ...previousBalance, lastImportJob: undefined } : null, transactionIds: previous.map(r => r.id) })),
      } });
      if (!customer) {
        customer = await tx.customer.create({ data: { organizationId: actor.organizationId,
          externalCustomerCode: `ADV-${accountNumber}`, accountNumber, customerType: 'advance', name,
          nameNormalized: name.normalize('NFKC').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim(),
          notes: `حساب تحليلي متزامن من ${sourceAccount}`, createdByImportJob: job.id } });
      }
      const types = new Map<string, string>();
      for (const row of report.items) {
        if (types.has(row.documentType)) continue;
        const type = await tx.documentType.upsert({ where: { organizationId_name: { organizationId: actor.organizationId, name: row.documentType } }, update: {},
          create: { organizationId: actor.organizationId, name: row.documentType, effect: 'mixed' } });
        types.set(row.documentType, type.id);
      }
      if (previous.length) await tx.importedTransaction.updateMany({ where: { id: { in: previous.map(r => r.id) } }, data: { reversedAt: new Date() } });
      for (let start = 0; start < report.items.length; start += 250) {
        await tx.importedTransaction.createMany({ data: report.items.slice(start, start + 250).map((row, index) => ({
          customerId: customer.id, currencyCode: report.currency, documentTypeId: types.get(row.documentType)!,
          txDate: new Date(row.date), documentNumber: row.documentNumber, description: row.description, referenceNumber: row.reference,
          debit: row.debit, credit: row.credit, sourceRowNumber: start + index + 1, importJobId: job.id,
          lineHash: createHash('sha256').update(`${customer.id}|${report.currency}|${JSON.stringify(row)}`).digest('hex'),
        })) });
      }
      const balanceData = { openingDebit: Math.max(0, report.openingBalance), openingCredit: Math.max(0, -report.openingBalance),
        accountingBalance: report.periodEndBalance, lastImportJobId: job.id, updatedAt: new Date() };
      await tx.customerBalance.upsert({ where: { customerId_currencyCode: { customerId: customer.id, currencyCode: report.currency } },
        create: { customerId: customer.id, currencyCode: report.currency, ...balanceData }, update: balanceData });
      await tx.balanceSnapshot.create({ data: { customerId: customer.id, currencyCode: report.currency, balance: report.periodEndBalance, importJobId: job.id } });
      await tx.customer.update({ where: { id: customer.id }, data: { updatedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actor.id, action: 'oracle_advance_ledger_synced', entityTable: 'customers', entityId: customer.id,
        newValue: { importJobId: job.id, currency: report.currency, transactions: report.total, balance: report.periodEndBalance, oracleWrite: 'NONE' } } });
      return { unchanged: false, created };
    }, { maxWait: 10_000, timeout: 60_000 });
  }
}
