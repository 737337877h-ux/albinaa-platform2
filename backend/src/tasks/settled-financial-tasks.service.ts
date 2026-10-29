import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { orgDateOnly } from '../common/org-time';
import { PrismaService } from '../prisma/prisma.service';

/** Only tasks whose purpose is explicitly financial may be closed by settlement. */
export const SETTLED_FINANCIAL_TASK_TYPES = [
  'promise_due', 'promise_due_today', 'promise_overdue', 'promise_escalation', 'collection_remaining',
] as const;

export type SettlementBalanceEvidence = {
  currency: string;
  balance: string;
  importedAt: string | null;
  ledgerFingerprint: string;
};

export type FinancialTaskReview = {
  id: string;
  customerId: string | null;
  status: string;
  taskType: string;
  dueDate: string;
  sourcePromiseId: string | null;
  sourcePromiseCustomerId: string | null;
  expectedCurrency: string | null;
  expectedAmount: string | null;
  assignedTo: string | null;
  createdAt: string;
  priorityReason: string | null;
  customer: { name: string; code: string | null; status: string; customerType: string | null } | null;
  balances: SettlementBalanceEvidence[];
  unknownLedgerCurrencies: string[];
};

export type FinancialTaskExclusion =
  | 'not_open' | 'not_financial' | 'not_overdue' | 'customer_unavailable'
  | 'missing_balances' | 'unknown_currency' | 'missing_import_provenance'
  | 'invalid_balance' | 'positive_balance' | 'invalid_promise_source';

export function settledFinancialTaskExclusion(
  task: FinancialTaskReview, asOfDate: string, knownCurrencies: ReadonlySet<string>,
): FinancialTaskExclusion | null {
  if (task.status !== 'open') return 'not_open';
  if (!(SETTLED_FINANCIAL_TASK_TYPES as readonly string[]).includes(task.taskType)) return 'not_financial';
  if (!task.dueDate || task.dueDate >= asOfDate) return 'not_overdue';
  if (!task.customerId || !task.customer || task.customer.status !== 'active'
    || task.customer.customerType !== 'customer') return 'customer_unavailable';
  if (task.taskType.startsWith('promise_')
    && (!task.sourcePromiseId || task.sourcePromiseCustomerId !== task.customerId)) return 'invalid_promise_source';
  if (!task.balances.length || task.unknownLedgerCurrencies.length) return 'missing_balances';
  for (const row of task.balances) {
    if (!knownCurrencies.has(row.currency)) return 'unknown_currency';
    if (!row.importedAt) return 'missing_import_provenance';
    try {
      const balance = new Prisma.Decimal(row.balance);
      if (!balance.isFinite()) return 'invalid_balance';
      // Follow-up materiality is not settlement: even a small positive amount remains debt.
      if (balance.gt(0)) return 'positive_balance';
    } catch { return 'invalid_balance'; }
  }
  return null;
}

type ReviewOptions = { asOfDate?: string; taskIds?: string[]; collectorId?: string; limit?: number };
type ReviewSelection = { taskIds?: string[]; collectorId?: string; limit: number };
export type SettledFinancialTaskPlan = {
  version: 1;
  organizationId: string;
  asOfDate: string;
  createdAt: string;
  planHash: string;
  selection: ReviewSelection;
  examined: number;
  truncated: boolean;
  candidates: FinancialTaskReview[];
  excluded: Array<{ taskId: string; customerId: string | null; reason: FinancialTaskExclusion }>;
};

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const auditAction = 'financial_task_closed_after_settlement';

/**
 * Preview first. Apply closes only the exact reviewed plan, retaining the task and
 * an append-only audit row. No collection, ledger, balance, or promise is changed.
 */
@Injectable()
export class SettledFinancialTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private options(options: ReviewOptions = {}): { asOfDate: string; selection: ReviewSelection } {
    const asOfDate = options.asOfDate ?? orgDateOnly();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
      || Number.isNaN(new Date(`${asOfDate}T00:00:00Z`).getTime())
      || dateKey(new Date(`${asOfDate}T00:00:00Z`)) !== asOfDate
      || asOfDate > orgDateOnly()) throw new BadRequestException('تاريخ مراجعة المهام غير صالح');
    const limit = options.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new BadRequestException('حد مراجعة المهام يجب أن يكون من 1 إلى 1000');
    }
    return { asOfDate, selection: {
      limit,
      ...(options.taskIds ? { taskIds: [...new Set(options.taskIds)].sort() } : {}),
      ...(options.collectorId ? { collectorId: options.collectorId } : {}),
    } };
  }

  private planHash(plan: Pick<SettledFinancialTaskPlan,
    'version' | 'organizationId' | 'asOfDate' | 'selection' | 'candidates'>) {
    return hash({ version: plan.version, organizationId: plan.organizationId,
      asOfDate: plan.asOfDate, selection: plan.selection, candidates: plan.candidates });
  }

  private async buildPlan(db: Prisma.TransactionClient, organizationId: string,
    asOfDate: string, selection: ReviewSelection): Promise<SettledFinancialTaskPlan> {
    const tasks = await db.task.findMany({
      where: {
        status: 'open', taskType: { in: [...SETTLED_FINANCIAL_TASK_TYPES] },
        dueDate: { lt: new Date(`${asOfDate}T00:00:00Z`) },
        customer: { organizationId },
        ...(selection.taskIds ? { id: { in: selection.taskIds } } : {}),
        ...(selection.collectorId ? { assignedTo: selection.collectorId } : {}),
      },
      select: { id: true, customerId: true, assignedTo: true, taskType: true, status: true,
        dueDate: true, sourcePromiseId: true, expectedCurrency: true, expectedAmount: true,
        createdAt: true, priorityReason: true,
        sourcePromise: { select: { customerId: true } },
        customer: { select: { name: true, externalCustomerCode: true, status: true, customerType: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: selection.limit + 1,
    });
    const selected = tasks.slice(0, selection.limit);
    const ids = [...new Set(selected.flatMap(t => t.customerId ? [t.customerId] : []))];
    const [balances, ledger, currencies] = await Promise.all([
      db.customerBalance.findMany({ where: { customerId: { in: ids }, customer: { organizationId } },
        select: { customerId: true, currencyCode: true, accountingBalance: true,
          lastImportJob: { select: { importedAt: true } } } }),
      db.operationalLedger.findMany({ where: { customerId: { in: ids }, customer: { organizationId } },
        select: { id: true, customerId: true, currencyCode: true, amountSigned: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      db.currency.findMany({ select: { code: true } }),
    ]);
    const knownCurrencies = new Set(currencies.map(c => c.code));
    const balancesByCustomer = new Map<string, SettlementBalanceEvidence[]>();
    const importedKeys = new Set(balances.map(b => `${b.customerId}|${b.currencyCode}`));
    const missingByCustomer = new Map<string, Set<string>>();
    const ledgerByKey = new Map<string, typeof ledger>();
    for (const entry of ledger) {
      const key = `${entry.customerId}|${entry.currencyCode}`;
      const rows = ledgerByKey.get(key) ?? []; rows.push(entry); ledgerByKey.set(key, rows);
      if (!importedKeys.has(key)) {
        const missing = missingByCustomer.get(entry.customerId) ?? new Set<string>();
        missing.add(entry.currencyCode); missingByCustomer.set(entry.customerId, missing);
      }
    }
    for (const row of balances) {
      const importedAt = row.lastImportJob?.importedAt ?? null;
      const postImport = (ledgerByKey.get(`${row.customerId}|${row.currencyCode}`) ?? [])
        .filter(entry => !importedAt || entry.createdAt > importedAt);
      let effective = new Prisma.Decimal(row.accountingBalance);
      for (const entry of postImport) effective = effective.plus(entry.amountSigned);
      const evidence = balancesByCustomer.get(row.customerId) ?? [];
      evidence.push({ currency: row.currencyCode, balance: effective.toString(),
        importedAt: importedAt?.toISOString() ?? null,
        ledgerFingerprint: hash(postImport.map(e => [e.id, e.amountSigned.toString(), e.createdAt.toISOString()])) });
      balancesByCustomer.set(row.customerId, evidence);
    }
    const candidates: FinancialTaskReview[] = [];
    const excluded: SettledFinancialTaskPlan['excluded'] = [];
    for (const task of selected) {
      const review: FinancialTaskReview = {
        ...task, dueDate: dateKey(task.dueDate), createdAt: task.createdAt.toISOString(),
        sourcePromiseCustomerId: task.sourcePromise?.customerId ?? null,
        expectedAmount: task.expectedAmount?.toString() ?? null,
        customer: task.customer ? { name: task.customer.name, code: task.customer.externalCustomerCode,
          status: task.customer.status, customerType: task.customer.customerType } : null,
        balances: [...(balancesByCustomer.get(task.customerId ?? '') ?? [])].sort((a, b) => a.currency.localeCompare(b.currency)),
        unknownLedgerCurrencies: [...(missingByCustomer.get(task.customerId ?? '') ?? [])].sort(),
      };
      const reason = settledFinancialTaskExclusion(review, asOfDate, knownCurrencies);
      if (reason) excluded.push({ taskId: task.id, customerId: task.customerId, reason });
      else candidates.push(review);
    }
    const plan: SettledFinancialTaskPlan = { version: 1, organizationId, asOfDate,
      createdAt: new Date().toISOString(), planHash: '', selection,
      examined: selected.length, truncated: tasks.length > selection.limit, candidates, excluded };
    plan.planHash = this.planHash(plan);
    return plan;
  }

  async preview(organizationId: string, options: ReviewOptions = {}) {
    const { asOfDate, selection } = this.options(options);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return this.buildPlan(tx, organizationId, asOfDate, selection);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
  }

  async apply(organizationId: string, reviewed: SettledFinancialTaskPlan,
    context: { actorId: string; reason: string }) {
    if (reviewed.version !== 1 || reviewed.organizationId !== organizationId
      || this.planHash(reviewed) !== reviewed.planHash) {
      throw new BadRequestException('خطة مراجعة المهام غير صالحة');
    }
    if (!context.actorId || !context.reason?.trim()) throw new BadRequestException('يلزم تحديد منفذ المراجعة وسببها');
    const { asOfDate, selection } = this.options({ ...reviewed.selection, asOfDate: reviewed.asOfDate });
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settled-financial-tasks'), hashtext(${organizationId}))`;
      const actor = await tx.user.findFirst({ where: { id: context.actorId, organizationId, isActive: true }, select: { id: true } });
      if (!actor) throw new BadRequestException('منفذ المراجعة غير موجود في المنشأة');
      if (!reviewed.candidates.length) return { applied: 0, alreadyApplied: 0, planHash: reviewed.planHash };
      const ids = reviewed.candidates.map(t => t.id);
      const previous = await tx.auditLog.findMany({ where: {
        action: auditAction, entityTable: 'tasks', entityId: { in: ids },
        newValue: { path: ['planHash'], equals: reviewed.planHash },
      }, select: { entityId: true } });
      if (new Set(previous.map(a => a.entityId)).size === ids.length) {
        const done = await tx.task.count({ where: { id: { in: ids }, status: 'done', customer: { organizationId } } });
        if (done === ids.length) return { applied: 0, alreadyApplied: ids.length, planHash: reviewed.planHash };
      }
      const current = await this.buildPlan(tx, organizationId, asOfDate, selection);
      if (current.planHash !== reviewed.planHash) {
        throw new ConflictException('تغيّرت المهام أو الأرصدة منذ المراجعة؛ أعد المعاينة قبل الإغلاق');
      }
      for (const task of current.candidates) {
        const updated = await tx.task.updateMany({ where: { id: task.id, status: 'open',
          taskType: task.taskType, customerId: task.customerId,
          dueDate: new Date(`${task.dueDate}T00:00:00Z`), customer: { organizationId } },
          data: { status: 'done' } });
        if (updated.count !== 1) throw new ConflictException('تغيّرت إحدى المهام أثناء المراجعة');
        await tx.auditLog.create({ data: {
          userId: actor.id, action: auditAction, entityTable: 'tasks', entityId: task.id,
          oldValue: task as unknown as Prisma.InputJsonValue,
          newValue: { status: 'done', result: 'account_settled', planHash: reviewed.planHash,
            asOfDate, balances: task.balances } as Prisma.InputJsonValue,
          reason: context.reason.trim(),
        } });
      }
      return { applied: current.candidates.length, alreadyApplied: 0, planHash: reviewed.planHash };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
  }
}
