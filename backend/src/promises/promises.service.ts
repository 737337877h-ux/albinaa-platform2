import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromiseDto } from './dto/create-promise.dto';
import { PromiseStatusDto } from './dto/promise-status.dto';
import { QueryPromisesDto } from './dto/query-promises.dto';
import { UpdatePromiseDto } from './dto/update-promise.dto';

/**
 * حالات الوعد (القائمة الغنية المعتمدة — تغطي Pending/Fulfilled/Broken/Cancelled):
 * upcoming → due_today → fulfilled | partially_fulfilled | unfulfilled | postponed | cancelled_approved
 */
const OPEN_STATUSES = ['upcoming', 'due_today'];
/** الحالات النهائية المعتمدة في مراجعة M5: partially_fulfilled ليست نهائية. */
const FINAL_STATUSES = ['fulfilled', 'unfulfilled', 'cancelled_approved'];

/**
 * State Machine المعتمدة (موثقة في README + مختبرة):
 * upcoming/due_today/partially_fulfilled → fulfilled | partially_fulfilled |
 *   unfulfilled | cancelled_approved | postponed(إجراء بموعد جديد)
 * الحالات النهائية لا تقبل أي انتقال.
 * postponed لا تُخزَّن كحالة راكدة: التأجيل يحدّث dueDate ويعيد الحالة
 *   إلى upcoming/due_today (الحدث موثق في statusReason + Audit + Timeline).
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  upcoming: ['fulfilled', 'partially_fulfilled', 'unfulfilled', 'cancelled_approved', 'postponed'],
  due_today: ['fulfilled', 'partially_fulfilled', 'unfulfilled', 'cancelled_approved', 'postponed'],
  partially_fulfilled: ['fulfilled', 'partially_fulfilled', 'unfulfilled', 'cancelled_approved', 'postponed'],
  fulfilled: [],
  unfulfilled: [],
  cancelled_approved: [],
};

function statusForDueDate(dueDate: Date): 'upcoming' | 'due_today' {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return dueDate.getTime() <= today.getTime() ? 'due_today' : 'upcoming';
}

@Injectable()
export class PromisesService {
  private readonly logger = new Logger(PromisesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async collectorOf(user: AuthUser) {
    return this.prisma.collector.findUnique({ where: { userId: user.id } });
  }

  /**
   * البند ثانيًا من مراجعة M5: شرط الإسناد الحالي.
   * - غير الإشرافي: العميل يجب أن يكون مسندًا إليه حاليًا (effective_to IS NULL).
   * - الإشرافي (customers.read_all): يسجل نيابة عن محصل آخر بعد التحقق من
   *   المحصل ومن أن العميل مسند إليه حاليًا.
   */
  private async assertCurrentAssignment(
    actor: AuthUser, customerId: string, collectorId: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: actor.organizationId },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود');
    const assignment = await this.prisma.customerAssignment.findFirst({
      where: { customerId, collectorId, effectiveTo: null },
    });
    if (!assignment) {
      throw new ForbiddenException('العميل غير مسند حاليًا لهذا المحصل — يلزم إسناد ساري');
    }
    return customer;
  }

  private async scope(user: AuthUser): Promise<Prisma.PaymentPromiseWhereInput> {
    const base: Prisma.PaymentPromiseWhereInput = {
      customer: { organizationId: user.organizationId },
    };
    if (user.permissions.includes('customers.read_all')) return base;
    const collector = await this.collectorOf(user);
    if (!collector) return { ...base, id: 'no-access' };
    return { ...base, collectorId: collector.id };
  }

  async create(actor: AuthUser, dto: CreatePromiseDto, req?: Request) {
    // المحصل يسجل وعدًا لنفسه؛ الإداري يمكنه تحديد collectorId
    let collectorId = dto.collectorId;
    const own = await this.collectorOf(actor);
    if (!collectorId) {
      if (!own) throw new BadRequestException('حدد المحصل (collectorId) — حسابك ليس محصلاً');
      collectorId = own.id;
    } else if (own && collectorId !== own.id && !actor.permissions.includes('customers.read_all')) {
      throw new ForbiddenException('لا يمكنك تسجيل وعد باسم محصل آخر');
    }

    // البند ثانيًا: شرط الإسناد الحالي (لكل المستخدمين — والإشرافي نيابةً بعد نفس التحقق)
    const customer = await this.assertCurrentAssignment(actor, dto.customerId, collectorId);
    const currency = await this.prisma.currency.findFirst({
      where: { code: dto.currencyCode, active: true },
    });
    if (!currency) throw new BadRequestException('العملة غير معروفة');

    const dueDate = new Date(dto.dueDate);
    const status = statusForDueDate(dueDate);

    const collector = await this.prisma.collector.findUniqueOrThrow({
      where: { id: collectorId }, include: { user: true },
    });

    // البند ثالثًا: الوعد + مهمته في Transaction واحدة — لا وعد بلا مهمة أبدًا
    const promise = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentPromise.create({
        data: {
          customerId: dto.customerId,
          collectorId,
          promiseDate: dto.promiseDate ? new Date(dto.promiseDate) : new Date(),
          dueDate,
          expectedAmount: dto.expectedAmount,
          currencyCode: dto.currencyCode,
          expectedMethodId: dto.expectedMethodId,
          notes: dto.notes,
          status,
        },
      });
      await tx.task.create({
        data: {
          customerId: dto.customerId,
          assignedTo: collectorId,
          createdBy: actor.id,
          taskType: 'promise_due',
          dueDate,
          priorityReason: 'وعد سداد مستحق',
          expectedAmount: dto.expectedAmount,
          expectedCurrency: dto.currencyCode,
          sourcePromiseId: created.id,
        },
      });
      return created;
    });
    // الإشعار بعد نجاح المعاملة (غير حرج — لا يترك بيانات جزئية)
    await this.notifications.notifyUser(collector.userId, 'promise_due', {
      promiseId: promise.id, customerId: dto.customerId, customerName: customer.name,
      dueDate: dto.dueDate, amount: dto.expectedAmount, currency: dto.currencyCode,
    });

    await this.audit.log({
      userId: actor.id, action: 'promise_created', entityTable: 'payment_promises',
      entityId: promise.id,
      newValue: { customerId: dto.customerId, amount: dto.expectedAmount, currency: dto.currencyCode, dueDate: dto.dueDate },
      req,
    });
    return promise;
  }

  async findAll(user: AuthUser, q: QueryPromisesDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where = await this.scope(user);
    if (q.customerId) where.customerId = q.customerId;
    if (q.status) where.status = q.status;
    if (q.dueFrom || q.dueTo) {
      where.dueDate = {};
      if (q.dueFrom) (where.dueDate as any).gte = new Date(q.dueFrom);
      if (q.dueTo) (where.dueDate as any).lte = new Date(q.dueTo);
    }
    const [total, items] = await Promise.all([
      this.prisma.paymentPromise.count({ where }),
      this.prisma.paymentPromise.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, externalCustomerCode: true } },
          collector: { include: { user: { select: { fullName: true } } } },
        },
        orderBy: { dueDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { page, limit, total, totalPages: Math.ceil(total / limit), items };
  }

  async findOne(user: AuthUser, id: string) {
    const where = await this.scope(user);
    const p = await this.prisma.paymentPromise.findFirst({
      where: { ...where, id },
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        collector: { include: { user: { select: { fullName: true } } } },
        tasks: true,
      },
    });
    if (!p) throw new NotFoundException('الوعد غير موجود أو خارج نطاق صلاحيتك');
    return p;
  }

  async update(actor: AuthUser, id: string, dto: UpdatePromiseDto, req?: Request) {
    const before = await this.findOne(actor, id);
    if (FINAL_STATUSES.includes(before.status)) {
      throw new ConflictException('لا يمكن تعديل وعد بحالة نهائية — سجّل وعدًا جديدًا');
    }

    let newDueDate: Date | undefined;
    let newStatus: string | undefined;
    if (dto.dueDate) {
      newDueDate = new Date(dto.dueDate);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      // البند رابعًا: تاريخ ماضٍ لا يُقبل مباشرة — التأخير له مسار الحالة (unfulfilled بسبب)
      if (newDueDate.getTime() < today.getTime()) {
        throw new BadRequestException(
          'لا يُقبل تاريخ استحقاق ماضٍ في التعديل المباشر — استخدم تغيير الحالة (إخلال بسبب) أو التأجيل بموعد قادم',
        );
      }
      newStatus = statusForDueDate(newDueDate);
    }

    // البند رابعًا: تحديث الوعد ومهمة promise_due المفتوحة معًا (ذريًا)
    const updated = await this.prisma.$transaction(async (tx) => {
      const p = await tx.paymentPromise.update({
        where: { id },
        data: {
          dueDate: newDueDate,
          status: newStatus,
          expectedAmount: dto.expectedAmount,
          expectedMethodId: dto.expectedMethodId,
          notes: dto.notes,
        },
      });
      if (newDueDate) {
        await tx.task.updateMany({
          where: { sourcePromiseId: id, taskType: 'promise_due', status: 'open' },
          data: { dueDate: newDueDate },
        });
      }
      return p;
    });

    await this.audit.log({
      userId: actor.id, action: 'promise_updated', entityTable: 'payment_promises', entityId: id,
      oldValue: { dueDate: before.dueDate, status: before.status, amount: Number(before.expectedAmount) },
      newValue: { dueDate: dto.dueDate ?? null, status: newStatus ?? before.status, ...dto }, req,
    });
    return updated;
  }

  async setStatus(actor: AuthUser, id: string, dto: PromiseStatusDto, req?: Request) {
    const before = await this.findOne(actor, id);

    // البند خامسًا: State Machine صارمة — الانتقالات المسموحة فقط
    const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new ConflictException(
        `انتقال غير مسموح: ${before.status} → ${dto.status}. المسموح من الحالة الحالية: ${allowed.join(', ') || 'لا شيء (حالة نهائية)'}`,
      );
    }
    if (['unfulfilled', 'cancelled_approved', 'postponed'].includes(dto.status) && !dto.reason) {
      throw new BadRequestException('الإخلال/الإلغاء/التأجيل يتطلب ذكر السبب (قاعدة معتمدة)');
    }
    // partially_fulfilled: مبلغ منفذ إلزامي، موجب، وأقل من المتوقع (وإلا فهو fulfilled)
    if (dto.status === 'partially_fulfilled') {
      if (dto.fulfilledAmount === undefined || dto.fulfilledAmount === null) {
        throw new BadRequestException('التنفيذ الجزئي يتطلب fulfilledAmount (قيمة رقمية لا حالة نصية)');
      }
      if (dto.fulfilledAmount <= 0 || dto.fulfilledAmount >= Number(before.expectedAmount)) {
        throw new BadRequestException(
          `fulfilledAmount يجب أن يكون بين 0 و ${Number(before.expectedAmount)} حصريًا — المساوي أو الأكبر يعني fulfilled`,
        );
      }
    }
    // postponed: موعد استحقاق جديد إلزامي وقادم — ولا تبقى الحالة راكدة
    let postponeDueDate: Date | undefined;
    if (dto.status === 'postponed') {
      if (!dto.newDueDate) {
        throw new BadRequestException('التأجيل يتطلب newDueDate — لا يبقى وعد مؤجلاً بلا موعد جديد');
      }
      postponeDueDate = new Date(dto.newDueDate);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (postponeDueDate.getTime() <= today.getTime()) {
        throw new BadRequestException('موعد التأجيل يجب أن يكون تاريخًا قادمًا');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const effectiveStatus =
        dto.status === 'postponed' ? statusForDueDate(postponeDueDate!) : dto.status;
      const p = await tx.paymentPromise.update({
        where: { id },
        data: {
          status: effectiveStatus,
          statusReason: dto.reason ?? null,
          fulfilledAmount:
            dto.status === 'partially_fulfilled' ? dto.fulfilledAmount
            : dto.status === 'fulfilled' ? Number(before.expectedAmount)
            : undefined,
          dueDate: postponeDueDate,
        },
      });
      // التأجيل يحدّث مهمة الوعد المفتوحة للموعد الجديد (البند خامسًا)
      if (dto.status === 'postponed') {
        await tx.task.updateMany({
          where: { sourcePromiseId: id, taskType: 'promise_due', status: 'open' },
          data: { dueDate: postponeDueDate },
        });
      }
      // إغلاق مهمة الوعد المرتبطة عند الحالات النهائية
      if (FINAL_STATUSES.includes(dto.status)) {
        await tx.task.updateMany({
          where: { sourcePromiseId: id, status: 'open' },
          data: { status: dto.status === 'unfulfilled' ? 'escalated' : 'done' },
        });
      }
      // قاعدة معتمدة (§12): الوعد غير المنفذ → مهمة تصعيد جديدة
      if (dto.status === 'unfulfilled') {
        await tx.task.create({
          data: {
            customerId: before.customerId,
            assignedTo: before.collectorId,
            createdBy: actor.id,
            taskType: 'promise_escalation',
            dueDate: new Date(),
            priorityReason: `وعد غير منفذ: ${dto.reason}`,
            expectedAmount: before.expectedAmount,
            expectedCurrency: before.currencyCode,
            sourcePromiseId: id,
          },
        });
      }
      return p;
    });

    if (dto.status === 'unfulfilled') {
      const collector = await this.prisma.collector.findUniqueOrThrow({
        where: { id: before.collectorId },
      });
      await this.notifications.notifyUser(collector.userId, 'promise_overdue', {
        promiseId: id, customerId: before.customerId, reason: dto.reason,
      });
    }

    await this.audit.log({
      userId: actor.id,
      action: dto.status === 'postponed' ? 'promise_postponed' : 'promise_status_changed',
      entityTable: 'payment_promises',
      entityId: id,
      oldValue: { status: before.status, dueDate: before.dueDate },
      newValue: {
        status: dto.status, reason: dto.reason,
        newDueDate: dto.newDueDate ?? null, fulfilledAmount: dto.fulfilledAmount ?? null,
      },
      req,
    });
    return updated;
  }

  /**
   * مسح الوعود المتأخرة (يستدعيه محرك المهام اليومي):
   * وعد مفتوح تجاوز استحقاقه → unfulfilled تلقائيًا + مهمة تصعيد + إشعار.
   * قاعدة معتمدة من المتطلبات الأصلية §12.
   */
  async sweepOverdue(orgId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = await this.prisma.paymentPromise.findMany({
      where: {
        customer: { organizationId: orgId },
        status: { in: OPEN_STATUSES },
        dueDate: { lt: today },
      },
      include: { collector: true, customer: { select: { name: true } } },
    });
    // --- تسجيل تشخيصي مؤقت: يُزال بعد تحديد السبب الحقيقي لـ 500 ---
    this.logger.debug(`[sweepOverdue] بدء — ${overdue.length} وعدًا متأخرًا للمنشأة ${orgId}`);
    for (const p of overdue) {
      this.logger.debug(
        `[sweepOverdue] معالجة الوعد ${p.id} `
        + `(collectorId=${p.collectorId}, customerId=${p.customerId}, `
        + `collector موجود=${!!p.collector}, customer موجود=${!!p.customer})`,
      );
      // العلاقتان إلزاميتان في المخطط (FK غير قابل للإفراغ). لا نُخفي غيابهما
      // بتخطٍّ صامت — هذا فساد بيانات حقيقي يستحق الظهور فورًا وبوضوح،
      // لا الابتلاع (قرار صريح بعد اعتراض المراجعة على الإصلاح الدفاعي السابق).
      if (!p.collector || !p.customer) {
        throw new Error(
          `sweepOverdue: الوعد ${p.id} بلا علاقة محصل/عميل صالحة رغم أن العمودين `
          + `إلزاميان في المخطط (collectorId=${p.collectorId}, customerId=${p.customerId})`,
        );
      }
      this.logger.debug(`[sweepOverdue] ${p.id} — بدء المعاملة (update+updateMany+create)`);
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentPromise.update({
          where: { id: p.id },
          data: { status: 'unfulfilled', statusReason: 'انقضى تاريخ الاستحقاق دون تحصيل مناسب (تلقائي)' },
        });
        await tx.task.updateMany({
          where: { sourcePromiseId: p.id, status: 'open' },
          data: { status: 'escalated' },
        });
        await tx.task.create({
          data: {
            customerId: p.customerId,
            assignedTo: p.collectorId,
            taskType: 'promise_escalation',
            dueDate: today,
            priorityReason: 'وعد سداد متأخر — تصعيد تلقائي',
            expectedAmount: p.expectedAmount,
            expectedCurrency: p.currencyCode,
            sourcePromiseId: p.id,
          },
        });
      });
      this.logger.debug(`[sweepOverdue] ${p.id} — انتهت المعاملة، إرسال الإشعار`);
      await this.notifications.notifyUser(p.collector.userId, 'promise_overdue', {
        promiseId: p.id, customerId: p.customerId, customerName: p.customer.name,
        amount: Number(p.expectedAmount), currency: p.currencyCode,
      });
      this.logger.debug(`[sweepOverdue] ${p.id} — اكتمل بالكامل`);
    }
    this.logger.debug('[sweepOverdue] انتهى المسح — تحديث upcoming→due_today لوعود اليوم');
    // تحديث upcoming → due_today لوعود اليوم
    await this.prisma.paymentPromise.updateMany({
      where: {
        customer: { organizationId: orgId },
        status: 'upcoming',
        dueDate: { equals: today },
      },
      data: { status: 'due_today' },
    });
    this.logger.debug(`[sweepOverdue] انتهى بالكامل — swept=${overdue.length}`);
    return { swept: overdue.length };
  }
}
