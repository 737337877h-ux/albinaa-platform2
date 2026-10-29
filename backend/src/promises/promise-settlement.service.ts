import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { orgDateOnly } from '../common/org-time';
import { oracleReceiptActivity } from '../common/oracle-receipt-activity';
import { PrismaService } from '../prisma/prisma.service';
import { planPromiseSettlements, SettlementReceipt } from './promise-settlement-plan';

export interface ReconcilePromiseOptions {
  dryRun?: boolean;
  customerIds?: string[];
  promiseIds?: string[];
  now?: Date;
  expectedPlanHash?: string;
  maxChanges?: number;
  /** Only the trusted scheduler uses this; manual apply must bind to its preview. */
  automatic?: boolean;
  actorId?: string;
}

@Injectable()
export class PromiseSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcileForOrganization(organizationId: string, options: ReconcilePromiseOptions = {}) {
    const dryRun = options.dryRun !== false;
    if (!dryRun && !options.automatic && !options.expectedPlanHash) {
      throw new ConflictException('اعرض خطة مطابقة الوعود أولًا ثم طبّق بصمة الخطة نفسها');
    }
    const now = options.now ?? new Date();
    const maxChanges = Math.max(1, Math.min(500, options.maxChanges ?? 200));
    return this.prisma.$transaction(async (tx) => {
      if (!dryRun) {
        // Every automatic receipt allocation for this organization shares this lock.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`promise-settlement|${organizationId}`}, 0))::TEXT`;
      }
      const customerScope = { organizationId, ...(options.customerIds?.length ? { id: { in: options.customerIds } } : {}) };
      // Load competing promises too: a bounded apply must never hide an overlap.
      const promises = await tx.paymentPromise.findMany({
        where: { customer: customerScope }, orderBy: [{ promiseDate: 'asc' }, { id: 'asc' }],
      });
      const customerIds = [...new Set(promises.map(p => p.customerId))];
      if (!customerIds.length) return { organizationId, dryRun, applied: 0,
        ...planPromiseSettlements([], [], [], now, options.promiseIds) };
      const actor = { id: options.actorId ?? '', organizationId, permissions: ['customers.read_all'] } as AuthUser;
      const [local, direct, existing] = await Promise.all([
        tx.collection.findMany({ where: { customer: customerScope, customerId: { in: customerIds }, status: 'recorded', amount: { gt: 0 } },
          select: { id: true, customerId: true, currencyCode: true, amount: true, collectedAt: true, referenceNumber: true, receiptNumber: true } }),
        oracleReceiptActivity(tx as any, actor),
        (tx as any).paymentPromiseReceiptAllocation.findMany({
          where: { organizationId, customerId: { in: customerIds } }, orderBy: [{ receiptDate: 'asc' }, { id: 'asc' }],
        }),
      ]);
      const receipts: SettlementReceipt[] = [
        ...local.map(row => ({ key: `local:${row.id}`, customerId: row.customerId, currencyCode: row.currencyCode,
          amount: row.amount, receiptDate: orgDateOnly(row.collectedAt), occurredAt: row.collectedAt,
          precision: 'timestamp' as const, source: 'local_collection' as const, sourceId: row.id })),
        ...direct.filter(row => customerIds.includes(row.customerId)).map(row => {
          const value = row as typeof row & { settlementKey?: string };
          const receiptDate = orgDateOnly(new Date(row.collectedAt));
          return { key: value.settlementKey ?? `IAS20261|${receiptDate.slice(0, 4)}:${row.referenceNumber}|${row.customerId}|${row.currencyCode}`,
            customerId: row.customerId, currencyCode: row.currencyCode, amount: row.amount,
            receiptDate, precision: 'day' as const, source: 'oracle_receipt' as const, sourceId: row.referenceNumber };
        }),
      ];
      const plan = planPromiseSettlements(promises as any, receipts, existing, now, options.promiseIds);
      if (options.expectedPlanHash && options.expectedPlanHash !== plan.planHash) {
        throw new ConflictException('تغيّرت بيانات المطابقة بعد المعاينة؛ أعد عرض الخطة قبل التطبيق');
      }
      if (plan.changes.length > maxChanges) {
        throw new ConflictException(`خطة المطابقة تضم ${plan.changes.length} وعدًا؛ حدّد عملاء أو وعودًا لتطبيق دفعة لا تتجاوز ${maxChanges}`);
      }
      if (!dryRun) {
        for (const allocation of plan.allocations) {
          await (tx as any).paymentPromiseReceiptAllocation.create({ data: {
            ...allocation, organizationId, receiptDate: new Date(`${allocation.receiptDate}T00:00:00Z`),
          } });
        }
        for (const change of plan.changes) {
          const reason = change.status === 'fulfilled'
            ? (change.settledLate ? 'تمت التسوية بعد الموعد بسندات تحصيل معتمدة' : 'تم الوفاء بسندات تحصيل معتمدة')
            : 'تمت مطابقة سداد جزئي بسندات تحصيل معتمدة';
          const result = await tx.paymentPromise.updateMany({
            where: { id: change.promiseId, status: change.previousStatus },
            data: { status: change.status, fulfilledAmount: change.fulfilledAmount,
              settlementDate: change.settlementDate ? new Date(`${change.settlementDate}T00:00:00Z`) : null,
              settledLate: change.settledLate,
              missedDueDate: change.missedDueDate ? new Date(`${change.missedDueDate}T00:00:00Z`) : null,
              statusReason: change.previousStatusReason ? `${change.previousStatusReason}\n${reason}` : reason } as any,
          });
          if (result.count !== 1) throw new ConflictException('تغيّرت حالة الوعد أثناء المطابقة؛ أعد المعاينة');
          if (change.status === 'fulfilled') {
            await tx.task.updateMany({ where: { sourcePromiseId: change.promiseId, status: { in: ['open', 'escalated'] },
              taskType: { in: ['promise_due', 'promise_due_today', 'promise_overdue', 'promise_escalation'] } },
              data: { status: 'done' } });
          }
          // Audit is part of the transaction: a settlement cannot commit without its history.
          await tx.auditLog.create({ data: { userId: options.actorId ?? null, action: 'promise_receipt_settlement',
            entityTable: 'payment_promises', entityId: change.promiseId,
            oldValue: { status: change.previousStatus, fulfilledAmount: change.previousFulfilledAmount, statusReason: change.previousStatusReason },
            newValue: { ...change, planHash: plan.planHash, allocations: plan.allocations.filter(row => row.promiseId === change.promiseId) } as any,
            reason } });
        }
      }
      return { organizationId, dryRun, applied: dryRun ? 0 : plan.changes.length, ...plan };
    }, { timeout: 120_000, maxWait: 15_000,
      isolationLevel: dryRun ? Prisma.TransactionIsolationLevel.RepeatableRead : Prisma.TransactionIsolationLevel.Serializable });
  }
}
