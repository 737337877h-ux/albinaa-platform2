import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { hasExplicitTimeZone, orgYear, startOfNextOrgDay, startOfOrgDay } from '../common/org-time';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiskRefreshService } from '../risk/risk-refresh.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { QueryCollectionsDto } from './dto/query-collections.dto';
import { ReverseCollectionDto } from './dto/reverse-collection.dto';
import { CreateHandoverVoucherDto } from './dto/create-handover-voucher.dto';
import { ReviewReversalRequestDto } from './dto/review-reversal-request.dto';

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
    private readonly accountingPeriods: AccountingPeriodsService,
    @Optional() private readonly riskRefresh?: RiskRefreshService,
  ) {}

  private async collectorOf(user: AuthUser) {
    return this.prisma.collector.findUnique({ where: { userId: user.id } });
  }

  private async nextReceiptNumber(tx: Prisma.TransactionClient, branchId: string, year: number) {
    const rows = await tx.$queryRaw<{ number: number }[]>`
      INSERT INTO branch_receipt_sequences (branch_id, year, next_number)
      VALUES (${branchId}::uuid, ${year}, 2)
      ON CONFLICT (branch_id, year)
      DO UPDATE SET next_number = branch_receipt_sequences.next_number + 1
      RETURNING next_number - 1 AS number
    `;
    return `R-${year}-${String(rows[0].number).padStart(6, '0')}`;
  }

  private async nextVoucherSequence(tx: Prisma.TransactionClient, branchId: string, year: number) {
    const rows = await tx.$queryRaw<{ number: number }[]>`
      INSERT INTO branch_voucher_sequences (branch_id, year, next_number)
      VALUES (${branchId}::uuid, ${year}, 2)
      ON CONFLICT (branch_id, year)
      DO UPDATE SET next_number = branch_voucher_sequences.next_number + 1
      RETURNING next_number - 1 AS number
    `;
    return rows[0].number;
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

  async listMethods(user: AuthUser) {
    return this.prisma.collectionMethod.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(actor: AuthUser, dto: CreateCollectionDto, req?: Request) {
    const isAdmin = actor.permissions.includes('customers.read_all');
    let collectorId = dto.collectorId;
    const own = await this.collectorOf(actor);
    if (!collectorId) {
      if (own) {
        collectorId = own.id;
      } else if (isAdmin) {
        const assignment = await this.prisma.customerAssignment.findFirst({
          where: { customerId: dto.customerId, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (assignment) {
          collectorId = assignment.collectorId;
        } else {
          throw new BadRequestException('العميل غير مسند لأي محصل — يلزم إسناد ساري أو تحديد collectorId');
        }
      } else {
        throw new BadRequestException('حدد المحصل (collectorId) — حسابك ليس محصلاً');
      }
    } else if (own && collectorId !== own.id && !isAdmin) {
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
    // Admins with customers.read_all bypass assignment check
    if (!currentAssignment && !isAdmin) {
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
    const fallbackBranch = dto.branchId ?? collector.branchId ?? customer.branchId
      ? null
      : await this.prisma.branch.findFirst({
        where: { organizationId: actor.organizationId, active: true }, orderBy: { createdAt: 'asc' },
      });
    const branchId = dto.branchId ?? collector.branchId ?? customer.branchId ?? fallbackBranch?.id ?? null;
    if (!branchId) throw new BadRequestException('لا يوجد فرع نشط لترقيم الإيصال تسلسليًا');

    if (dto.collectedAt && !hasExplicitTimeZone(dto.collectedAt)) {
      throw new BadRequestException('تاريخ التحصيل يجب أن يتضمن المنطقة الزمنية صراحةً');
    }
    const collectedAt = dto.collectedAt ? new Date(dto.collectedAt) : new Date();
    if (Number.isNaN(collectedAt.getTime())) throw new BadRequestException('تاريخ التحصيل غير صالح');
    await this.accountingPeriods.assertDatesOpen(actor, [collectedAt], dto.accountingOverrideReason, 'collection_created', req);

    const collection = await this.prisma.$transaction(async (tx) => {
      const receiptNumber = await this.nextReceiptNumber(tx, branchId, orgYear(collectedAt));
      const created = await tx.collection.create({
        data: {
          customerId: dto.customerId,
          collectorId,
          branchId,
          currencyCode: dto.currencyCode,
          amount: dto.amount,
          collectedAt,
          methodId: dto.methodId,
          referenceNumber: dto.referenceNumber ?? dto.receiptNumber,
          bankName: dto.bankName,
          chequeNumber: dto.chequeNumber,
          chequeDate: dto.chequeDate ? new Date(dto.chequeDate) : null,
          receiptNumber,
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
        customerId: dto.customerId,
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
    await this.riskRefresh?.trigger(actor, [dto.customerId], 'collection_created', req);
    return collection;
  }

  async findAll(user: AuthUser, q: QueryCollectionsDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where = await this.scope(user);
    if (q.customerId) where.customerId = q.customerId;
    // A collector-scoped user must never replace the collectorId installed by
    // scope(); cross-collector reporting requires the reporting permission.
    if (q.collectorId && user.permissions.includes('reports.read')) where.collectorId = q.collectorId;
    if (q.branchId) where.branchId = q.branchId;
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
        handoverVoucherItem: { include: { voucher: true } },
        reversalRequests: { orderBy: { requestedAt: 'desc' } },
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

    const pending = await this.prisma.collectionReversalRequest.findFirst({
      where: { collectionId: id, status: 'pending' },
    });
    if (pending) throw new ConflictException('يوجد طلب عكس معلق لهذه العملية');
    const reversalRequest = await this.prisma.collectionReversalRequest.create({
      data: { collectionId: id, reason: dto.reason, requestedBy: actor.id },
    });
    await this.notifications.notifyByPermission(
      actor.organizationId, 'collections.approve', 'collection_reversal_requested', {
        requestId: reversalRequest.id, collectionId: id, amount: Number(original.amount),
        currency: original.currencyCode, reason: dto.reason,
      },
    );
    await this.audit.log({
      userId: actor.id, action: 'collection_reversal_requested', entityTable: 'collection_reversal_requests',
      entityId: reversalRequest.id, newValue: { collectionId: id, reason: dto.reason }, req,
    });
    return { requestId: reversalRequest.id, status: 'pending', message: 'أُرسل طلب العكس للموافقة الثنائية' };
  }

  private async executeReversal(actor: AuthUser, original: {
    id: string; customerId: string; collectorId: string; branchId: string | null;
    currencyCode: string; amount: Prisma.Decimal; methodId: string; status: string;
    reversedById: string | null;
  }, reason: string, approval: { requestId: string; note?: string } | null = null) {
    const id = original.id;
    // حماية التزامن بثلاث طبقات داخل معاملة واحدة:
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
            notes: `عكس موثق للعملية ${original.id}: ${reason}`,
            status: 'reversed',
          },
        });
        await tx.collection.update({
          where: { id },
          data: { reversedById: mirror.id },
        });
        if (approval) {
          const reviewed = await tx.collectionReversalRequest.updateMany({
            where: { id: approval.requestId, status: 'pending', requestedBy: { not: actor.id } },
            data: {
              status: 'approved', reviewedBy: actor.id, reviewedAt: new Date(),
              reviewNote: approval.note ?? null, reversalId: mirror.id,
            },
          });
          if (reviewed.count !== 1) throw new ConflictException('تمت مراجعة طلب العكس من مستخدم آخر');
        }
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

    return result;
  }

  async reviewReversal(actor: AuthUser, requestId: string, dto: ReviewReversalRequestDto, req?: Request) {
    const reversalRequest = await this.prisma.collectionReversalRequest.findFirst({
      where: { id: requestId, collection: { customer: { organizationId: actor.organizationId } } },
      include: { collection: true },
    });
    if (!reversalRequest) throw new NotFoundException('طلب العكس غير موجود');
    if (reversalRequest.status !== 'pending') throw new ConflictException('تمت مراجعة الطلب مسبقًا');
    if (reversalRequest.requestedBy === actor.id) {
      throw new ForbiddenException('لا يمكن لمنشئ طلب العكس اعتماده — يلزم مستخدم ثانٍ');
    }
    if (!dto.approve) {
      const rejected = await this.prisma.collectionReversalRequest.update({
        where: { id: requestId }, data: {
          status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: dto.note ?? null,
        },
      });
      await this.audit.log({
        userId: actor.id, action: 'collection_reversal_rejected', entityTable: 'collection_reversal_requests',
        entityId: requestId, newValue: { note: dto.note ?? null }, req,
      });
      return rejected;
    }
    const original = reversalRequest.collection;
    if (original.status === 'reversed') throw new ConflictException('العملية معكوسة مسبقًا');
    const mirror = await this.executeReversal(actor, original, reversalRequest.reason, { requestId, note: dto.note });
    await this.audit.log({
      userId: actor.id, action: 'collection_reversed', entityTable: 'collections', entityId: original.id,
      oldValue: { status: original.status },
      newValue: { requestId, reversalId: mirror.id, reason: reversalRequest.reason }, req,
    });
    await this.riskRefresh?.trigger(actor, [original.customerId], 'collection_reversed', req);
    await this.notifications.notifyFinance(actor.organizationId, 'collection_reversed', {
      collectionId: original.id,
      reversalId: mirror.id,
      customerId: original.customerId,
      amount: Number(original.amount),
      currency: original.currencyCode,
      reason: reversalRequest.reason,
      actorName: actor.fullName,
      href: '/collections/reconciliation',
    });
    return { original: original.id, reversal: mirror.id, requestId, message: 'اعتمد المستخدم الثاني العكس ونُفذ بأثر تدقيقي كامل' };
  }

  async reconciliationBoard(
    actor: AuthUser,
    filters: { collectorId?: string; branchId?: string; currency?: string },
  ) {
    const base = { customer: { organizationId: actor.organizationId } };
    const [candidates, legacyWithoutBranch] = await Promise.all([this.prisma.collection.findMany({
      where: {
        ...base, status: 'recorded', handoverVoucherItem: null,
        ...(filters.collectorId ? { collectorId: filters.collectorId } : {}),
        ...(filters.branchId ? { branchId: filters.branchId } : { branchId: { not: null } }),
        ...(filters.currency ? { currencyCode: filters.currency } : {}),
      },
      include: {
        customer: { select: { name: true, externalCustomerCode: true } },
        collector: { include: { user: { select: { fullName: true } } } },
        branch: { select: { name: true } }, method: { select: { name: true } },
      },
      orderBy: { collectedAt: 'asc' }, take: 500,
    }), this.prisma.collection.count({ where: { ...base, status: 'recorded', branchId: null } })]);
    const vouchers = await this.prisma.collectionHandoverVoucher.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(filters.collectorId ? { collectorId: filters.collectorId } : {}),
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.currency ? { currencyCode: filters.currency } : {}),
      },
      include: {
        branch: { select: { name: true } }, collector: { include: { user: { select: { fullName: true } } } },
        creator: { select: { fullName: true } }, matcher: { select: { fullName: true } },
        approver: { select: { fullName: true } },
        items: { include: { collection: { include: { customer: { select: { name: true, externalCustomerCode: true } } } } } },
      },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    const pendingReversals = await this.prisma.collectionReversalRequest.findMany({
      where: { status: 'pending', collection: base },
      include: {
        requester: { select: { fullName: true } },
        collection: { include: { customer: { select: { name: true } } } },
      },
      orderBy: { requestedAt: 'asc' },
    });
    return { candidates, vouchers, pendingReversals, legacyWithoutBranch };
  }

  async createHandoverVoucher(actor: AuthUser, dto: CreateHandoverVoucherDto, req?: Request) {
    const ids = [...new Set(dto.collectionIds)];
    if (ids.length !== dto.collectionIds.length) throw new BadRequestException('توجد تحصيلات مكررة في التحديد');
    const collections = await this.prisma.collection.findMany({
      where: { id: { in: ids }, customer: { organizationId: actor.organizationId } },
      include: { handoverVoucherItem: true },
    });
    if (collections.length !== ids.length) throw new NotFoundException('بعض التحصيلات غير موجودة أو خارج المنشأة');
    if (collections.some((c) => c.status !== 'recorded' || c.handoverVoucherItem)) {
      throw new ConflictException('كل التحصيلات يجب أن تكون مسجلة وغير مضافة لقسيمة سابقة');
    }
    const first = collections[0];
    if (!first.branchId) throw new BadRequestException('لا يمكن إنشاء قسيمة لتحصيل بلا فرع');
    if (collections.some((c) => c.collectorId !== first.collectorId
      || c.branchId !== first.branchId || c.currencyCode !== first.currencyCode)) {
      throw new BadRequestException('القسيمة الواحدة تقبل محصلاً وفرعًا وعملة واحدة فقط');
    }
    const total = collections.reduce((sum, c) => sum + Number(c.amount), 0);
    const year = orgYear();
    const voucher = await this.prisma.$transaction(async (tx) => {
      const sequence = await this.nextVoucherSequence(tx, first.branchId!, year);
      const serialNumber = `H-${year}-${String(sequence).padStart(6, '0')}`;
      const created = await tx.collectionHandoverVoucher.create({
        data: {
          organizationId: actor.organizationId, branchId: first.branchId!, collectorId: first.collectorId,
          currencyCode: first.currencyCode, serialNumber, sequenceYear: year,
          sequenceNumber: sequence, totalAmount: total, createdBy: actor.id,
          items: { create: collections.map((c) => ({ collectionId: c.id, amount: c.amount })) },
        },
      });
      const updated = await tx.collection.updateMany({
        where: { id: { in: ids }, status: 'recorded' }, data: { status: 'handed_to_cashier' },
      });
      if (updated.count !== ids.length) throw new ConflictException('تغيرت حالة أحد التحصيلات أثناء إنشاء القسيمة');
      return created;
    });
    await this.audit.log({
      userId: actor.id, action: 'handover_voucher_created', entityTable: 'collection_handover_vouchers',
      entityId: voucher.id, newValue: { serialNumber: voucher.serialNumber, collectionIds: ids, total, currency: first.currencyCode }, req,
    });
    return voucher;
  }

  private async voucherInOrg(actor: AuthUser, id: string) {
    const voucher = await this.prisma.collectionHandoverVoucher.findFirst({
      where: { id, organizationId: actor.organizationId }, include: { items: true },
    });
    if (!voucher) throw new NotFoundException('قسيمة التسليم غير موجودة');
    return voucher;
  }

  async matchHandoverVoucher(actor: AuthUser, id: string, req?: Request) {
    const voucher = await this.voucherInOrg(actor, id);
    if (voucher.status !== 'submitted') throw new ConflictException('القسيمة طوبقت أو قُفلت مسبقًا');
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.collectionHandoverVoucher.updateMany({
        where: { id, status: 'submitted' }, data: { status: 'matched', matchedBy: actor.id, matchedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('طابق مستخدم آخر القسيمة للتو');
      const itemIds = voucher.items.map((item) => item.collectionId);
      const collections = await tx.collection.findMany({ where: { id: { in: itemIds } } });
      if (collections.some((collection) => collection.status !== 'handed_to_cashier')) {
        throw new ConflictException('حالة أحد التحصيلات لا تسمح بالمطابقة');
      }
      await tx.collection.updateMany({ where: { id: { in: itemIds } }, data: { status: 'matched' } });
      await tx.cashHandover.createMany({ data: collections.map((collection) => ({
        collectionId: collection.id, currencyCode: collection.currencyCode, amount: collection.amount,
        cashierId: actor.id, receiptNumber: voucher.serialNumber,
      })) });
    });
    await this.audit.log({
      userId: actor.id, action: 'handover_voucher_matched', entityTable: 'collection_handover_vouchers', entityId: id, req,
    });
    return { id, status: 'matched', message: 'طابق أمين الصندوق القسيمة' };
  }

  async lockHandoverVoucher(actor: AuthUser, id: string, req?: Request) {
    const voucher = await this.voucherInOrg(actor, id);
    if (voucher.status !== 'matched') throw new ConflictException('يجب مطابقة القسيمة قبل اعتمادها وقفلها');
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.collectionHandoverVoucher.updateMany({
        where: { id, status: 'matched' }, data: { status: 'locked', approvedBy: actor.id, approvedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('اعتمد مستخدم آخر القسيمة للتو');
      const itemIds = voucher.items.map((item) => item.collectionId);
      const collections = await tx.collection.updateMany({
        where: { id: { in: itemIds }, status: 'matched' }, data: { status: 'approved' },
      });
      if (collections.count !== itemIds.length) throw new ConflictException('تعذر قفل جميع التحصيلات بسبب تغير متزامن');
    });
    await this.audit.log({
      userId: actor.id, action: 'handover_voucher_locked', entityTable: 'collection_handover_vouchers', entityId: id, req,
    });
    return { id, status: 'locked', message: 'اعتُمدت القسيمة وقُفلت نهائيًا' };
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
