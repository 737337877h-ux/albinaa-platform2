import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { startOfNextOrgDay, startOfOrgDay } from '../common/org-time';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { QueryCollectionsDto } from './dto/query-collections.dto';
import { ReverseCollectionDto } from './dto/reverse-collection.dto';

/**
 * قواعد التحصيل المعتمدة (مطبقة هنا وبـ Triggers في القاعدة):
 * - لا مبلغ صفريًا أو سالبًا (CHECK في القاعدة + DTO).
 * - لا تعديل بعد التسجيل (لا يوجد PATCH أصلاً) ولا حذف (Trigger يمنع DELETE).
 * - التصحيح بعملية عكس موثقة فقط.
 * - كل تحصيل يقيّد في الدفتر التشغيلي (Append-Only) فيتحدث الرصيد التشغيلي
 *   تلقائيًا (مشتق من الدفتر — لا حقل يُعدَّل يدويًا).
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async collectorOf(user: AuthUser) {
    return this.prisma.collector.findUnique({ where: { userId: user.id } });
  }

  private async scope(user: AuthUser): Promise<Prisma.CollectionWhereInput> {
    const base: Prisma.CollectionWhereInput = {
      customer: { organizationId: user.organizationId },
    };
    if (user.permissions.includes('customers.read_all')) return base;
    const collector = await this.collectorOf(user);
    if (!collector) return { ...base, id: 'no-access' };
    return { ...base, collectorId: collector.id };
  }

  async create(actor: AuthUser, dto: CreateCollectionDto, req?: Request) {
    let collectorId = dto.collectorId;
    const own = await this.collectorOf(actor);
    if (!collectorId) {
      if (!own) throw new BadRequestException('حدد المحصل (collectorId) — حسابك ليس محصلاً');
      collectorId = own.id;
    } else if (own && collectorId !== own.id && !actor.permissions.includes('customers.read_all')) {
      throw new ForbiddenException('لا يمكنك تسجيل تحصيل باسم محصل آخر');
    }

    const [customer, currency, method, collector, currentAssignment] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId: actor.organizationId },
      }),
      this.prisma.currency.findFirst({ where: { code: dto.currencyCode, active: true } }),
      this.prisma.collectionMethod.findFirst({
        where: { id: dto.methodId, organizationId: actor.organizationId, active: true },
      }),
      this.prisma.collector.findUnique({
        where: { id: collectorId },
        include: { user: { select: { fullName: true, organizationId: true } } },
      }),
      this.prisma.customerAssignment.findFirst({
        where: { customerId: dto.customerId, collectorId, effectiveTo: null },
      }),
    ]);
    if (!customer) throw new NotFoundException('العميل غير موجود');
    if (!currency) throw new BadRequestException('العملة غير معروفة');
    if (!method) throw new BadRequestException('طريقة الدفع غير موجودة أو معطلة');
    if (!collector || !collector.active || collector.user.organizationId !== actor.organizationId) {
      throw new BadRequestException('المحصل غير موجود أو غير نشط');
    }
    // البند ثانيًا (مراجعة M5): شرط الإسناد الحالي — للجميع، والإشرافي نيابةً بعد نفس التحقق
    if (!currentAssignment) {
      throw new ForbiddenException('العميل غير مسند حاليًا لهذا المحصل — يلزم إسناد ساري');
    }

    // البند سادسًا: التحقق الكامل من الفرع إن مُرر صراحة (وجود + نفس المنشأة + نشط)
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, organizationId: actor.organizationId, active: true },
      });
      if (!branch) {
        throw new BadRequestException('الفرع غير موجود أو غير تابع لمنشأتك أو معطل');
      }
    }
    // الفرع: من الطلب (بعد التحقق)، وإلا فرع المحصل، وإلا فرع العميل (قيمة تاريخية)
    const branchId = dto.branchId ?? collector.branchId ?? customer.branchId ?? null;

    const collection = await this.prisma.$transaction(async (tx) => {
      const created = await tx.collection.create({
        data: {
          customerId: dto.customerId,
          collectorId,
          branchId,
          currencyCode: dto.currencyCode,
          amount: dto.amount,
          collectedAt: dto.collectedAt ? new Date(dto.collectedAt) : new Date(),
          methodId: dto.methodId,
          referenceNumber: dto.referenceNumber,
          bankName: dto.bankName,
          chequeNumber: dto.chequeNumber,
          chequeDate: dto.chequeDate ? new Date(dto.chequeDate) : null,
          receiptNumber: dto.receiptNumber,
          notes: dto.notes,
          status: 'recorded',
        },
      });
      // القيد التشغيلي: التحصيل يخفض المديونية (سالب) — Append-Only
      await tx.operationalLedger.create({
        data: {
          customerId: dto.customerId,
          currencyCode: dto.currencyCode,
          entryType: 'collection',
          amountSigned: -dto.amount,
          sourceTable: 'collections',
          sourceId: created.id,
          createdBy: actor.id,
        },
      });
      return created;
    });

    // النقدي يظهر لأمين الصندوق حتى يؤكد الاستلام (قاعدة معتمدة §13)
    await this.notifications.notifyByPermission(
      actor.organizationId, 'cash.receive', 'collection_created', {
        collectionId: collection.id,
        customerName: customer.name,
        collectorName: collector.user.fullName,
        amount: dto.amount,
        currency: dto.currencyCode,
        method: method.name,
      },
    );

    await this.audit.log({
      userId: actor.id, action: 'collection_created', entityTable: 'collections',
      entityId: collection.id,
      newValue: {
        customerId: dto.customerId, amount: dto.amount,
        currency: dto.currencyCode, method: method.name,
      },
      req,
    });
    return collection;
  }

  async findAll(user: AuthUser, q: QueryCollectionsDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where = await this.scope(user);
    if (q.customerId) where.customerId = q.customerId;
    if (q.currency) where.currencyCode = q.currency;
    if (q.status) where.status = q.status;
    if (q.fromDate || q.toDate) {
      // تصحيح مراجعة Dashboard: حدود اليوم بتوقيت المنشأة (+03:00)، والنهاية
      // "بداية اليوم التالي" غير شاملة (lt) — لا (lte) على نفس بداية اليوم،
      // وإلا استُبعدت كل حركات ذلك اليوم فعليًا (الخطأ المُبلَّغ عنه).
      where.collectedAt = {};
      if (q.fromDate) (where.collectedAt as any).gte = startOfOrgDay(q.fromDate);
      if (q.toDate) (where.collectedAt as any).lt = startOfNextOrgDay(q.toDate);
    }
    const [total, items, sums] = await Promise.all([
      this.prisma.collection.count({ where }),
      this.prisma.collection.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, externalCustomerCode: true } },
          collector: { include: { user: { select: { fullName: true } } } },
          method: { select: { name: true } },
          branch: { select: { name: true } },
        },
        orderBy: { collectedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.collection.groupBy({
        by: ['currencyCode'],
        where: { ...where, status: { not: 'reversed' } },
        _sum: { amount: true },
      }),
    ]);
    return {
      page, limit, total, totalPages: Math.ceil(total / limit),
      totalsByCurrency: Object.fromEntries(
        sums.map((s) => [s.currencyCode, Number(s._sum.amount ?? 0)]),
      ),
      items,
    };
  }

  async findOne(user: AuthUser, id: string) {
    const where = await this.scope(user);
    const c = await this.prisma.collection.findFirst({
      where: { ...where, id },
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        collector: { include: { user: { select: { fullName: true } } } },
        method: true,
        branch: true,
        handover: true,
        reversedBy: true,
        reversals: true,
      },
    });
    if (!c) throw new NotFoundException('عملية التحصيل غير موجودة أو خارج نطاق صلاحيتك');
    return c;
  }

  /**
   * عكس موثق: العملية الأصلية → reversed، سجل عكس مرآة، وقيد تشغيلي معاكس.
   * لا حذف ولا تعديل أبدًا — الأثر التدقيقي كامل.
   */
  async reverse(actor: AuthUser, id: string, dto: ReverseCollectionDto, req?: Request) {
    if (!actor.permissions.includes('collections.reverse')) {
      throw new ForbiddenException('عكس التحصيل يتطلب صلاحية collections.reverse');
    }
    const original = await this.findOne(actor, id);
    if (original.status === 'reversed') {
      throw new ConflictException('العملية معكوسة مسبقًا');
    }

    // البند سابعًا (مراجعة M5): حماية التزامن بثلاث طبقات داخل معاملة واحدة:
    // 1) قيد الدفتر المعاكس أولاً — UNIQUE(source_table, source_id, entry_type)
    //    في القاعدة يجعل أي محاولة عكس ثانية تفشل على مستوى قاعدة البيانات
    //    نفسها فتنقضّ المعاملة كلها (الصمام الصلب).
    // 2) تحديث مشروط للحالة مع فحص عدد الصفوف المتأثرة === 1.
    // 3) الفحص المبدئي أعلاه (تحسين تجربة فقط — ليس خط الدفاع).
    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await tx.operationalLedger.create({
          data: {
            customerId: original.customerId,
            currencyCode: original.currencyCode,
            entryType: 'collection_reversal',
            amountSigned: Number(original.amount),
            sourceTable: 'collections',
            sourceId: original.id,
            createdBy: actor.id,
          },
        });
        const conditional = await tx.collection.updateMany({
          where: { id, status: { not: 'reversed' }, reversedById: null },
          data: { status: 'reversed' },
        });
        if (conditional.count !== 1) {
          throw new ConflictException('العملية معكوسة مسبقًا (سباق تزامن مكتشف)');
        }
        const mirror = await tx.collection.create({
          data: {
            customerId: original.customerId,
            collectorId: original.collectorId,
            branchId: original.branchId,
            currencyCode: original.currencyCode,
            amount: original.amount,
            collectedAt: new Date(),
            methodId: original.methodId,
            notes: `عكس موثق للعملية ${original.id}: ${dto.reason}`,
            status: 'reversed',
          },
        });
        await tx.collection.update({
          where: { id },
          data: { reversedById: mirror.id },
        });
        return mirror;
      });
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      // انتهاك قيد الدفتر الفريد = عكس متزامن ثانٍ — بلا سجل أو قيد إضافي (Rollback كامل)
      if ((e as any)?.code === 'P2002') {
        throw new ConflictException('العملية معكوسة مسبقًا — قيد العكس الفريد منع التكرار');
      }
      throw e;
    }

    await this.audit.log({
      userId: actor.id, action: 'collection_reversed', entityTable: 'collections', entityId: id,
      oldValue: { status: original.status },
      newValue: { reversalId: result.id, reason: dto.reason }, req,
    });
    return { original: id, reversal: result.id, message: 'عُكست العملية بأثر تدقيقي كامل' };
  }

  /**
   * إضافة موثقة (متطلب M6): تأكيد أمين الصندوق استلام النقدية.
   * ينشئ سجل cash_handover (فريد لكل عملية) ويحوّل الحالة recorded → handed_to_cashier.
   */
  async handover(actor: AuthUser, id: string, receiptNumber: string | undefined, req?: Request) {
    const collection = await this.prisma.collection.findFirst({
      where: { id, customer: { organizationId: actor.organizationId } },
    });
    if (!collection) throw new NotFoundException('عملية التحصيل غير موجودة');
    if (collection.status === 'reversed') {
      throw new ConflictException('لا يمكن استلام عملية معكوسة');
    }
    if (collection.status !== 'recorded') {
      throw new ConflictException('العملية مستلمة أو معتمدة مسبقًا');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.collection.updateMany({
        where: { id, status: 'recorded' },
        data: { status: 'handed_to_cashier' },
      });
      if (updated.count !== 1) {
        throw new ConflictException('العملية استُلمت للتو من مستخدم آخر');
      }
      return tx.cashHandover.create({
        data: {
          collectionId: id,
          currencyCode: collection.currencyCode,
          amount: collection.amount,
          cashierId: actor.id,
          receiptNumber: receiptNumber ?? null,
        },
      });
    });
    await this.audit.log({
      userId: actor.id, action: 'collection_handed_to_cashier', entityTable: 'collections',
      entityId: id, newValue: { receiptNumber: receiptNumber ?? null }, req,
    });
    return { collectionId: id, handoverId: result.id, message: 'تم تأكيد استلام النقدية' };
  }
}
