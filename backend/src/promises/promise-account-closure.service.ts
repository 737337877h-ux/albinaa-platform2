import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { orgCalendarDayUtc, orgDateOnly } from '../common/org-time';
import { PrismaService } from '../prisma/prisma.service';

export const CLOSED_SETTLED_PROMISE = 'closed_settled';
const OPEN = ['upcoming', 'due_today', 'partially_fulfilled', 'unfulfilled'];
const TASK_TYPES = ['promise_due', 'promise_due_today', 'promise_overdue', 'promise_escalation'];
const reason = 'أُغلقت المتابعة بعد تسوية الحساب؛ مبالغ السداد الفعلية وتاريخ التأخر محفوظة دون إنشاء تحصيل جديد';

/** Administrative closure is distinct from receipt-backed fulfillment. */
@Injectable()
export class PromiseAccountClosureService {
  constructor(private readonly prisma: PrismaService) {}

  private async review(db: Prisma.TransactionClient, actor: AuthUser, id: string, now: Date) {
    if (!actor.permissions.includes('promises.create')) throw new ForbiddenException('لا تملك صلاحية إنهاء متابعة الوعد');
    const own = actor.permissions.includes('customers.read_all') ? null
      : await db.collector.findUnique({ where: { userId: actor.id }, select: { id: true } });
    const scope = actor.permissions.includes('customers.read_all') ? {} : { collectorId: own?.id ?? '00000000-0000-0000-0000-000000000000' };
    const selected = await db.paymentPromise.findFirst({ where: { id, customer: { organizationId: actor.organizationId }, ...scope },
      include: { customer: { select: { id: true, status: true, customerType: true, mergedIntoId: true } } } });
    if (!selected) throw new NotFoundException('الوعد غير موجود أو خارج نطاق صلاحيتك');
    const today = orgCalendarDayUtc(now);
    const promises = await db.paymentPromise.findMany({ where: { customerId: selected.customerId,
      currencyCode: selected.currencyCode, status: { in: OPEN }, dueDate: { lt: today }, ...scope }, orderBy: { id: 'asc' } });
    const [balances, ledger, currencies, tasks] = await Promise.all([
      db.customerBalance.findMany({ where: { customerId: selected.customerId }, orderBy: { currencyCode: 'asc' },
        select: { currencyCode: true, accountingBalance: true, updatedAt: true, lastImportJobId: true,
          lastImportJob: { select: { importedAt: true } } } }),
      db.operationalLedger.findMany({ where: { customerId: selected.customerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, currencyCode: true, amountSigned: true, createdAt: true } }),
      db.currency.findMany({ select: { code: true } }),
      db.task.findMany({ where: { sourcePromiseId: { in: promises.map(p => p.id) }, status: { in: ['open', 'escalated'] },
        taskType: { in: TASK_TYPES } }, orderBy: { id: 'asc' }, select: { id: true, sourcePromiseId: true, status: true, taskType: true } }),
    ]);
    const errors: string[] = [];
    if (selected.customer.status !== 'active' || selected.customer.mergedIntoId) errors.push('الحساب غير متاح للمراجعة');
    if (!promises.some(p => p.id === id) || promises.length > 200) errors.push('الإغلاق مخصص للوعود القديمة الظاهرة في نطاقك');
    if (!balances.length) errors.push('لم تكتمل بيانات رصيد الحساب');
    const known = new Set(currencies.map(c => c.code));
    if (ledger.some(row => !balances.some(b => b.currencyCode === row.currencyCode))) errors.push('توجد حركة بعملة لم يكتمل رصيدها');
    const evidence = balances.map(row => {
      const importedAt = row.lastImportJob?.importedAt;
      const postImport = ledger.filter(entry => entry.currencyCode === row.currencyCode && (!importedAt || entry.createdAt > importedAt));
      let effective = new Prisma.Decimal(row.accountingBalance);
      for (const entry of postImport) effective = effective.plus(entry.amountSigned);
      if (!known.has(row.currencyCode) || !importedAt || !effective.isFinite()) errors.push('مصدر رصيد الحساب غير مكتمل');
      if (effective.gt(0)) errors.push(`يوجد رصيد مدين بعملة ${row.currencyCode}`);
      if (row.updatedAt.getTime() > now.getTime() || now.getTime() - row.updatedAt.getTime() > 24 * 60 * 60 * 1000
        || promises.some(p => p.createdAt > row.updatedAt)) errors.push('يلزم تحديث رصيد الحساب قبل إنهاء المتابعة');
      return { currencyCode: row.currencyCode, balance: effective.toFixed(4), updatedAt: row.updatedAt.toISOString(),
        importId: row.lastImportJobId, importedAt: importedAt?.toISOString() ?? null,
        postImport: postImport.map(entry => [entry.id, entry.amountSigned.toString(), entry.createdAt.toISOString()]) };
    });
    const canApply = errors.length === 0;
    const input = { selectedId: id, organizationId: actor.organizationId, actorId: actor.id, today: orgDateOnly(now),
      customerId: selected.customerId, currencyCode: selected.currencyCode, evidence, promises, tasks, canApply };
    return { ...input, planHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      reason: canApply ? 'سيتم إنهاء متابعة الوعود القديمة لعدم وجود رصيد مدين حسب آخر مزامنة؛ تبقى مبالغ السداد الفعلية والتأخر محفوظة دون إنشاء تحصيل جديد'
        : [...new Set(errors)].join('؛ ') };
  }

  async preview(actor: AuthUser, id: string, now = new Date()) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return this.review(tx, actor, id, now);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
  }

  async apply(actor: AuthUser, id: string, expectedPlanHash: string, now = new Date()) {
    if (!/^[a-f0-9]{64}$/.test(expectedPlanHash)) throw new ConflictException('اعرض خطة إنهاء المتابعة أولًا');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`promise-settlement|${actor.organizationId}`}, 0))::TEXT`;
      const plan = await this.review(tx, actor, id, now);
      if (!plan.canApply || plan.planHash !== expectedPlanHash) throw new ConflictException('تغير رصيد الحساب أو الوعود؛ أعد المعاينة قبل التأكيد');
      for (const promise of plan.promises) {
        const missedDueDate = promise.missedDueDate ?? promise.dueDate;
        const statusReason = [promise.statusReason, reason].filter(Boolean).join('\n');
        const changed = await tx.paymentPromise.updateMany({ where: { id: promise.id, status: promise.status,
          fulfilledAmount: promise.fulfilledAmount }, data: { status: CLOSED_SETTLED_PROMISE, statusReason, missedDueDate } });
        if (changed.count !== 1) throw new ConflictException('تغير الوعد أثناء المراجعة؛ أعد المعاينة');
        await tx.auditLog.create({ data: { userId: actor.id, action: 'promise_followup_closed_after_settlement',
          entityTable: 'payment_promises', entityId: promise.id, reason,
          oldValue: { status: promise.status, statusReason: promise.statusReason, fulfilledAmount: promise.fulfilledAmount?.toString() ?? null,
            missedDueDate: promise.missedDueDate?.toISOString() ?? null },
          newValue: { status: CLOSED_SETTLED_PROMISE, closedAt: now.toISOString(), planHash: plan.planHash,
            missedDueDate: missedDueDate.toISOString(), fulfilledAmountUnchanged: true, balances: plan.evidence,
            tasks: plan.tasks.filter(task => task.sourcePromiseId === promise.id) } as any } });
      }
      await tx.task.updateMany({ where: { id: { in: plan.tasks.map(task => task.id) }, status: { in: ['open', 'escalated'] } }, data: { status: 'done' } });
      return { completed: false, closed: true, status: CLOSED_SETTLED_PROMISE, closedCount: plan.promises.length,
        closedPromiseIds: plan.promises.map(p => p.id), reason };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
  }
}
