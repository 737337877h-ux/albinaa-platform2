import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RiskRefreshService } from '../risk/risk-refresh.service';
import { AssignCollectorDto } from './dto/assign-collector.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateCreditPolicyDto } from './dto/update-credit-policy.dto';
import { MergeDuplicateDto } from './dto/merge-duplicate.dto';
import { ReverseCustomerMergeDto } from './dto/reverse-customer-merge.dto';

/**
 * شكل استجابة GET /customers/:id/balances — تعريف صريح (بدل مصفوفة فارغة
 * بلا نوع) لأن TypeScript الصارم يستنتج `never[]` من `const result = []`
 * ويرفض أي `push()` لاحق (خطأ ضبطه فحص typecheck فعليًا على جهاز المستخدم).
 */
export interface CustomerBalanceResult {
  currency: string;
  accountingBalance: number;
  operationalBalance: number;
  openingDebit: number;
  openingCredit: number;
  declaredBalance: number | null;
  lastImportAt: Date | null;
}

function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAlias(s: string): string {
  return normalizeName(s).toLowerCase().replace(/[\s()+-]/g, '');
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly riskRefresh?: RiskRefreshService,
  ) {}

  // --------------------------------------------------------------------------
  // نطاق الرؤية: من لا يملك customers.read_all (المحصل) يرى عملاءه المسندين فقط
  // — القاعدة الأصلية من مستند المتطلبات، مطبقة في API لا في الواجهة.
  // --------------------------------------------------------------------------
  private async scopeWhere(user: AuthUser): Promise<Prisma.CustomerWhereInput> {
    const base: Prisma.CustomerWhereInput = { organizationId: user.organizationId };
    if (user.permissions.includes('customers.read_all')) return base;

    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    if (!collector) {
      // ليس محصلاً ولا يملك رؤية شاملة → لا يرى أي عميل
      return { ...base, id: 'no-access' };
    }
    return {
      ...base,
      assignments: { some: { collectorId: collector.id, effectiveTo: null } },
    };
  }

  private async assertAccess(user: AuthUser, customerId: string) {
    const where = await this.scopeWhere(user);
    const found = await this.prisma.customer.findFirst({ where: { ...where, id: customerId } });
    if (!found) throw new NotFoundException('العميل غير موجود أو خارج نطاق صلاحيتك');
    if (found.mergedIntoId) {
      throw new ConflictException(`تم دمج هذا السجل. استخدم العميل الأساسي: ${found.mergedIntoId}`);
    }
    return found;
  }

  // --------------------------------------------------------------------------
  // القائمة: بحث + تصفية + ترتيب + Pagination
  // --------------------------------------------------------------------------
  async findAll(user: AuthUser, q: QueryCustomersDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where = await this.scopeWhere(user);

    if (q.search) {
      const s = q.search.trim();
      where.OR = [
        { nameNormalized: { contains: normalizeName(s) } },
        { externalCustomerCode: { contains: s } },
        { phonePrimary: { contains: s } },
        { phoneSecondary: { contains: s } },
        { whatsapp: { contains: s } },
        { aliases: { some: { aliasNormalized: { contains: normalizeAlias(s) } } } },
      ];
    }
    if (q.region) where.region = q.region;
    if (q.branchId) where.branchId = q.branchId;
    if (q.status) where.status = q.status;
    else where.status = { not: 'merged' };
    if (q.collectorId) {
      where.assignments = { some: { collectorId: q.collectorId, effectiveTo: null } };
    }
    if (q.balanceState) {
      const balFilter: Prisma.CustomerBalanceWhereInput =
        q.balanceState === 'debtor'
          ? { accountingBalance: { gt: 0 } }
          : q.balanceState === 'creditor'
            ? { accountingBalance: { lt: 0 } }
            : { accountingBalance: 0 };
      if (q.currency) balFilter.currencyCode = q.currency;
      where.balances = { some: balFilter };
    }

    // الترتيب بالرصيد يتطلب عملة محددة (رصيد العميل معرّف لكل عملة، لا إجمالي مخلوط)
    if (q.sortBy === 'balance' && !q.currency) {
      throw new BadRequestException('الترتيب بالرصيد يتطلب تحديد العملة (currency=YER مثلاً)');
    }

    const total = await this.prisma.customer.count({ where });

    let customers;
    if (q.sortBy === 'balance') {
      // ترتيب بالرصيد لعملة محددة عبر العلاقة — العملاء بلا رصيد بهذه العملة آخر القائمة
      customers = await this.prisma.customer.findMany({
        where,
        include: this.listInclude(),
        orderBy: [
          {
            balances: {
              _count: 'desc', // من يملك رصيدًا بالعملة أولاً
            },
          },
          { name: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      });
      const dir = q.sortDir === 'desc' ? -1 : 1;
      customers.sort((a: any, b: any) => {
        const ba = Number(a.balances.find((x: any) => x.currencyCode === q.currency)?.accountingBalance ?? 0);
        const bb = Number(b.balances.find((x: any) => x.currencyCode === q.currency)?.accountingBalance ?? 0);
        return (ba - bb) * dir;
      });
    } else {
      const orderBy: Prisma.CustomerOrderByWithRelationInput =
        q.sortBy === 'code'
          ? { externalCustomerCode: q.sortDir ?? 'asc' }
          : q.sortBy === 'createdAt'
            ? { createdAt: q.sortDir ?? 'asc' }
            : { name: q.sortDir ?? 'asc' };
      customers = await this.prisma.customer.findMany({
        where,
        include: this.listInclude(),
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    }

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: customers.map((c: any) => this.shapeListItem(c)),
    };
  }

  private listInclude() {
    return {
      balances: { select: { currencyCode: true, accountingBalance: true, updatedAt: true } },
      assignments: {
        where: { effectiveTo: null },
        include: { collector: { include: { user: { select: { fullName: true } } } } },
      },
      branch: { select: { id: true, name: true } },
    } satisfies Prisma.CustomerInclude;
  }

  private shapeListItem(c: any) {
    return {
      id: c.id,
      externalCustomerCode: c.externalCustomerCode,
      name: c.name,
      phonePrimary: c.phonePrimary,
      region: c.region,
      status: c.status,
      branch: c.branch,
      currentCollector: c.assignments[0]
        ? { id: c.assignments[0].collectorId, name: c.assignments[0].collector.user.fullName }
        : null,
      balances: c.balances.map((b: any) => ({
        currency: b.currencyCode,
        balance: Number(b.accountingBalance),
        updatedAt: b.updatedAt,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Customer 360
  // --------------------------------------------------------------------------
  async find360(user: AuthUser, id: string) {
    await this.assertAccess(user, id);
    const c = await this.prisma.customer.findUniqueOrThrow({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        creditPolicy: true,
        balances: { include: { lastImportJob: { select: { id: true, importedAt: true, fileName: true } } } },
        assignments: {
          orderBy: { effectiveFrom: 'desc' },
          include: { collector: { include: { user: { select: { fullName: true } } } } },
        },
        scores: { orderBy: { computedAt: 'desc' }, take: 1 },
        duplicatesAsA: { where: { reviewStatus: 'pending' } },
        duplicatesAsB: { where: { reviewStatus: 'pending' } },
        _count: { select: { importedTxns: true, followups: true, promises: true, collections: true, tasks: true } },
      },
    });

    const current = c.assignments.find((a) => a.effectiveTo === null) ?? null;
    return {
      // البيانات الأساسية
      id: c.id,
      externalCustomerCode: c.externalCustomerCode,
      accountNumber: c.accountNumber,
      name: c.name,
      tradeName: c.tradeName,
      phonePrimary: c.phonePrimary,
      phoneSecondary: c.phoneSecondary,
      whatsapp: c.whatsapp,
      region: c.region,
      address: c.address,
      branch: c.branch,
      customerType: c.customerType,
      status: c.status,
      relationshipStartDate: c.relationshipStartDate,
      notes: c.notes,
      createdAt: c.createdAt,
      // الملخص المالي لكل عملة
      balances: c.balances.map((b) => ({
        currency: b.currencyCode,
        accountingBalance: Number(b.accountingBalance),
        declaredBalance: b.declaredBalance === null ? null : Number(b.declaredBalance),
        openingDebit: Number(b.openingDebit),
        openingCredit: Number(b.openingCredit),
        lastImport: b.lastImportJob
          ? { jobId: b.lastImportJob.id, at: b.lastImportJob.importedAt, file: b.lastImportJob.fileName }
          : null,
        updatedAt: b.updatedAt,
      })),
      // الإسناد
      currentCollector: current
        ? {
            collectorId: current.collectorId,
            name: current.collector.user.fullName,
            since: current.effectiveFrom,
          }
        : null,
      assignmentHistoryCount: c.assignments.length,
      // السياسة الائتمانية والمخاطر
      creditPolicy: c.creditPolicy,
      latestScore: c.scores[0] ?? null,
      pendingDuplicateAlerts: c.duplicatesAsA.length + c.duplicatesAsB.length,
      // عدادات النشاط (المتابعات/الوعود/التحصيل تُفعَّل في مراحلها)
      counts: c._count,
    };
  }

  // --------------------------------------------------------------------------
  // الخط الزمني الموحد — من كل المصادر المتاحة، Append-Only بطبيعته
  // --------------------------------------------------------------------------
  async timeline(user: AuthUser, id: string, page = 1, limit = 50) {
    await this.assertAccess(user, id);
    const [snapshots, assignments, audits, customer, followups, promises, collections] =
      await Promise.all([
        this.prisma.balanceSnapshot.findMany({
          where: { customerId: id, reversedAt: null },
          include: { importJob: { select: { fileName: true } } },
        }),
        this.prisma.customerAssignment.findMany({
          where: { customerId: id },
          include: { collector: { include: { user: { select: { fullName: true } } } } },
        }),
        this.prisma.auditLog.findMany({
          where: { entityTable: 'customers', entityId: id },
          include: { user: { select: { fullName: true } } },
        }),
        this.prisma.customer.findUniqueOrThrow({ where: { id } }),
        this.prisma.followup.findMany({
          where: { customerId: id, deletedAt: null },
          include: {
            type: { select: { name: true } },
            result: { select: { name: true } },
            user: { select: { fullName: true } },
          },
        }),
        this.prisma.paymentPromise.findMany({
          where: { customerId: id },
          include: { collector: { include: { user: { select: { fullName: true } } } } },
        }),
        this.prisma.collection.findMany({
          where: { customerId: id },
          include: {
            collector: { include: { user: { select: { fullName: true } } } },
            method: { select: { name: true } },
          },
        }),
      ]);

    const events: { at: Date; type: string; title: string; details?: unknown }[] = [];

    events.push({
      at: customer.createdAt,
      type: 'customer_created',
      title: customer.createdByImportJob ? 'أُنشئ العميل من استيراد Excel' : 'أُنشئ العميل يدويًا',
    });
    for (const s of snapshots) {
      events.push({
        at: s.snapshotAt,
        type: 'balance_snapshot',
        title: `تحديث رصيد من استيراد (${s.importJob.fileName})`,
        details: { currency: s.currencyCode, balance: Number(s.balance) },
      });
    }
    for (const a of assignments) {
      events.push({
        at: a.createdAt,
        type: 'assignment',
        title: `إسناد إلى المحصل ${a.collector.user.fullName}`,
        details: { from: a.effectiveFrom, to: a.effectiveTo, reason: a.reason },
      });
    }
    for (const l of audits) {
      events.push({
        at: l.createdAt,
        type: `audit:${l.action}`,
        title: `${l.action} بواسطة ${l.user?.fullName ?? 'النظام'}`,
        details: { old: l.oldValue, new: l.newValue, reason: l.reason },
      });
    }
    for (const f of followups) {
      events.push({
        at: f.followupAt,
        type: 'followup',
        title: `متابعة (${f.type.name}) — النتيجة: ${f.result.name} — بواسطة ${f.user.fullName}`,
        details: { notes: f.notes, nextFollowupDate: f.nextFollowupDate },
      });
    }
    for (const p of promises) {
      events.push({
        at: p.createdAt,
        type: 'payment_promise',
        title: `وعد سداد ${Number(p.expectedAmount).toLocaleString('en-US')} ${p.currencyCode} — استحقاق ${p.dueDate.toISOString().slice(0, 10)} (${p.status})`,
        details: { collector: p.collector.user.fullName, statusReason: p.statusReason },
      });
    }
    for (const col of collections) {
      events.push({
        at: col.collectedAt,
        type: col.status === 'reversed' && col.notes?.startsWith('عكس موثق')
          ? 'collection_reversal'
          : 'collection',
        title: col.notes?.startsWith('عكس موثق')
          ? `عكس تحصيل ${Number(col.amount).toLocaleString('en-US')} ${col.currencyCode}`
          : `تحصيل ${Number(col.amount).toLocaleString('en-US')} ${col.currencyCode} (${col.method.name}) — ${col.collector.user.fullName}`,
        details: { status: col.status, receiptNumber: col.receiptNumber, reference: col.referenceNumber },
      });
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    const total = events.length;
    return {
      page, limit, total, totalPages: Math.ceil(total / limit),
      items: events.slice((page - 1) * limit, page * limit),
    };
  }

  // --------------------------------------------------------------------------
  // أرصدة العميل حسب العملة (+ الرصيد التشغيلي المشتق)
  // --------------------------------------------------------------------------
  async balances(user: AuthUser, id: string) {
    await this.assertAccess(user, id);
    const rows = await this.prisma.customerBalance.findMany({
      where: { customerId: id },
      include: { lastImportJob: { select: { importedAt: true } } },
      orderBy: { currencyCode: 'asc' },
    });
    const result: CustomerBalanceResult[] = [];
    for (const b of rows) {
      // الرصيد التشغيلي = المحاسبي + صافي قيود الدفتر بعد آخر استيراد (لا يُعدل يدويًا)
      let ledgerDelta = 0;
      if (b.lastImportJob) {
        const agg = await this.prisma.operationalLedger.aggregate({
          _sum: { amountSigned: true },
          where: {
            customerId: id, currencyCode: b.currencyCode,
            createdAt: { gt: b.lastImportJob.importedAt },
          },
        });
        ledgerDelta = Number(agg._sum.amountSigned ?? 0);
      }
      result.push({
        currency: b.currencyCode,
        accountingBalance: Number(b.accountingBalance),
        operationalBalance: Number(b.accountingBalance) + ledgerDelta,
        openingDebit: Number(b.openingDebit),
        openingCredit: Number(b.openingCredit),
        declaredBalance: b.declaredBalance === null ? null : Number(b.declaredBalance),
        lastImportAt: b.lastImportJob?.importedAt ?? null,
      });
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // كشف الحساب: حركات بعملة واحدة + رصيد جارٍ صحيح حتى مع التصفية بالتاريخ
  // --------------------------------------------------------------------------
  async statement(user: AuthUser, id: string, q: StatementQueryDto) {
    await this.assertAccess(user, id);
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;

    const balance = await this.prisma.customerBalance.findUnique({
      where: { customerId_currencyCode: { customerId: id, currencyCode: q.currency } },
    });

    const baseWhere: Prisma.ImportedTransactionWhereInput = {
      customerId: id, currencyCode: q.currency, reversedAt: null,
    };
    const rangeWhere: Prisma.ImportedTransactionWhereInput = { ...baseWhere };
    if (q.fromDate || q.toDate) {
      rangeWhere.txDate = {};
      if (q.fromDate) (rangeWhere.txDate as any).gte = new Date(q.fromDate);
      if (q.toDate) (rangeWhere.txDate as any).lte = new Date(q.toDate);
    }

    // رصيد بداية الفترة = الافتتاحي + كل الحركات السابقة لبداية الفترة
    const opening = balance ? Number(balance.openingDebit) - Number(balance.openingCredit) : 0;
    let startBalance = opening;
    if (q.fromDate) {
      const prior = await this.prisma.importedTransaction.aggregate({
        _sum: { debit: true, credit: true },
        where: { ...baseWhere, txDate: { lt: new Date(q.fromDate) } },
      });
      startBalance += Number(prior._sum.debit ?? 0) - Number(prior._sum.credit ?? 0);
    }

    const [total, periodTotals] = await Promise.all([
      this.prisma.importedTransaction.count({ where: rangeWhere }),
      this.prisma.importedTransaction.aggregate({
        _sum: { debit: true, credit: true },
        where: rangeWhere,
      }),
    ]);
    const periodEndBalance = startBalance
      + Number(periodTotals._sum.debit ?? 0)
      - Number(periodTotals._sum.credit ?? 0);
    // الرصيد الجاري يتطلب معرفة مجموع ما قبل الصفحة الحالية داخل الفترة
    const beforePage = await this.prisma.importedTransaction.findMany({
      where: rangeWhere,
      orderBy: [{ txDate: 'asc' }, { sourceRowNumber: 'asc' }],
      take: (page - 1) * limit,
      select: { debit: true, credit: true },
    });
    let running = startBalance
      + beforePage.reduce((s, t) => s + Number(t.debit) - Number(t.credit), 0);

    const txns = await this.prisma.importedTransaction.findMany({
      where: rangeWhere,
      orderBy: [{ txDate: 'asc' }, { sourceRowNumber: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { documentType: { select: { name: true } } },
    });

    const items = txns.map((t) => {
      running += Number(t.debit) - Number(t.credit);
      return {
        date: t.txDate,
        documentType: t.documentType.name,
        documentNumber: t.documentNumber,
        description: t.description,
        reference: t.referenceNumber,
        debit: Number(t.debit),
        credit: Number(t.credit),
        runningBalance: running,
      };
    });

    return {
      currency: q.currency,
      openingBalance: opening,
      periodStartBalance: startBalance,
      periodEndBalance,
      currentBalance: balance ? Number(balance.accountingBalance) : periodEndBalance,
      equationClosed: q.fromDate || q.toDate || !balance
        ? true
        : Math.abs(periodEndBalance - Number(balance.accountingBalance)) < 0.005,
      page, limit, total, totalPages: Math.ceil(total / limit),
      items,
    };
  }

  // --------------------------------------------------------------------------
  // إنشاء/تعديل/حالة
  // --------------------------------------------------------------------------
  async create(actor: AuthUser, dto: CreateCustomerDto, req?: Request) {
    const dup = await this.prisma.customer.findUnique({
      where: {
        organizationId_externalCustomerCode: {
          organizationId: actor.organizationId,
          externalCustomerCode: dto.externalCustomerCode,
        },
      },
    });
    if (dup) throw new ConflictException('كود العميل مستخدم مسبقًا — منع تكرار العملاء');

    const customer = await this.prisma.customer.create({
      data: {
        organizationId: actor.organizationId,
        externalCustomerCode: dto.externalCustomerCode,
        name: dto.name,
        nameNormalized: normalizeName(dto.name),
        tradeName: dto.tradeName,
        phonePrimary: dto.phonePrimary,
        phoneSecondary: dto.phoneSecondary,
        whatsapp: dto.whatsapp,
        region: dto.region,
        address: dto.address,
        branchId: dto.branchId,
        customerType: dto.customerType,
        notes: dto.notes,
      },
    });

    // تنبيه تشابه اسم فوري عند الإنشاء اليدوي
    const sameName = await this.prisma.customer.findMany({
      where: {
        organizationId: actor.organizationId,
        nameNormalized: customer.nameNormalized,
        id: { not: customer.id },
      },
      select: { id: true },
    });
    for (const other of sameName) {
      await this.prisma.potentialDuplicateCustomer.upsert({
        where: { customerAId_customerBId: { customerAId: other.id, customerBId: customer.id } },
        update: {},
        create: {
          customerAId: other.id, customerBId: customer.id,
          matchReason: 'تطابق اسم تام بعد التطبيع مع اختلاف الكود (إنشاء يدوي)',
        },
      });
    }

    await this.audit.log({
      userId: actor.id, action: 'customer_created', entityTable: 'customers', entityId: customer.id,
      newValue: { code: dto.externalCustomerCode, name: dto.name }, req,
    });
    return { ...customer, similarNameAlerts: sameName.length };
  }

  async update(actor: AuthUser, id: string, dto: UpdateCustomerDto, req?: Request) {
    const before = await this.assertAccess(actor, id);
    if (!actor.permissions.includes('customers.write')) {
      throw new ForbiddenException('تعديل بيانات العملاء يتطلب صلاحية customers.write');
    }
    const data: Prisma.CustomerUpdateInput = { ...dto, updatedAt: new Date() };
    if (dto.name) (data as any).nameNormalized = normalizeName(dto.name);

    const customer = await this.prisma.customer.update({ where: { id }, data });
    await this.audit.log({
      userId: actor.id, action: 'customer_updated', entityTable: 'customers', entityId: id,
      oldValue: {
        name: before.name, phonePrimary: before.phonePrimary,
        region: before.region, address: before.address,
      },
      newValue: dto, req,
    });
    return customer;
  }

  async setStatus(actor: AuthUser, id: string, status: string, req?: Request) {
    const before = await this.assertAccess(actor, id);
    const customer = await this.prisma.customer.update({ where: { id }, data: { status } });
    await this.audit.log({
      userId: actor.id, action: 'customer_status_changed', entityTable: 'customers', entityId: id,
      oldValue: { status: before.status }, newValue: { status }, req,
    });
    return customer;
  }

  // --------------------------------------------------------------------------
  // نقل العميل بين المحصلين — يغلق الإسناد الحالي ويفتح جديدًا (التاريخ محفوظ)
  // --------------------------------------------------------------------------
  async assignCollector(actor: AuthUser, id: string, dto: AssignCollectorDto, req?: Request) {
    await this.assertAccess(actor, id);
    const collector = await this.prisma.collector.findFirst({
      where: { id: dto.collectorId, active: true },
      include: { user: { select: { organizationId: true, fullName: true } } },
    });
    if (!collector || collector.user.organizationId !== actor.organizationId) {
      throw new BadRequestException('المحصل غير موجود أو غير نشط');
    }

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const current = await this.prisma.customerAssignment.findFirst({
      where: { customerId: id, effectiveTo: null },
    });
    if (current?.collectorId === dto.collectorId) {
      throw new ConflictException('العميل مسند لهذا المحصل بالفعل');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (current) {
        // لا نعدل التاريخ السابق — نغلق الإسناد الحالي فقط
        await tx.customerAssignment.update({
          where: { id: current.id },
          data: { effectiveTo: effectiveFrom },
        });
      }
      const assignment = await tx.customerAssignment.create({
        data: {
          customerId: id,
          collectorId: dto.collectorId,
          effectiveFrom,
          reason: dto.reason,
          assignedBy: actor.id,
        },
      });
      // PR 8: المهام المفتوحة غير المسندة لنفس العميل تُسند للمحصل الجديد (لا نقل تلقائي)
      const tasksUpdated = await tx.task.updateMany({
        where: { customerId: id, status: 'open', assignedTo: null },
        data: { assignedTo: dto.collectorId },
      });
      return { assignment, tasksUpdated: tasksUpdated.count };
    });

    await this.audit.log({
      userId: actor.id, action: 'customer_reassigned', entityTable: 'customers', entityId: id,
      oldValue: { collectorId: current?.collectorId ?? null },
      newValue: { collectorId: dto.collectorId, reason: dto.reason, tasksUpdated: result.tasksUpdated }, req,
    });
    return { assignment: result.assignment, collectorName: collector.user.fullName, tasksUpdated: result.tasksUpdated };
  }

  /** إسناد العميل الحالي + قائمة المحصلين النشطين (لاختيار الإسناد من Customer360). */
  async assignment(user: AuthUser, id: string) {
    await this.assertAccess(user, id);
    const [current, collectors] = await Promise.all([
      this.prisma.customerAssignment.findFirst({
        where: { customerId: id, effectiveTo: null },
        include: { collector: { include: { user: { select: { fullName: true } } } } },
      }),
      this.prisma.collector.findMany({
        where: { active: true, user: { organizationId: user.organizationId } },
        include: { user: { select: { fullName: true } } },
        orderBy: { user: { fullName: 'asc' } },
      }),
    ]);
    return {
      assignment: current
        ? {
            collectorId: current.collectorId,
            collectorName: current.collector.user.fullName,
            since: current.effectiveFrom,
            reason: current.reason ?? null,
          }
        : null,
      collectors: collectors.map((c) => ({ id: c.id, name: c.user.fullName })),
    };
  }

  /** فك إسناد العميل: إغلاق الإسناد الحالي فقط (التاريخ محفوظ) + إعادة المهام المفتوحة المسندة للمحصل إلى غير مسندة. */
  async unassignCollector(actor: AuthUser, id: string, req?: Request) {
    await this.assertAccess(actor, id);
    const current = await this.prisma.customerAssignment.findFirst({
      where: { customerId: id, effectiveTo: null },
      include: { collector: { include: { user: { select: { fullName: true } } } } },
    });
    if (!current) {
      throw new BadRequestException('العميل غير مسند لأي محصل — لا حاجة لفك الإسناد');
    }
    const today = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // إغلاق الإسناد الحالي فقط — لا نعدل التاريخ السابق
      await tx.customerAssignment.update({
        where: { id: current.id },
        data: { effectiveTo: today },
      });
      // PR 8: فقط المهام المفتوحة المسندة لهذا المحصل تُعاد إلى غير مسندة.
      // لا نلمس المهام المغلقة، ولا مهام مسندة لمحصل آخر، ولا المهام غير المسندة أصلًا.
      const tasksUpdated = await tx.task.updateMany({
        where: { customerId: id, status: 'open', assignedTo: current.collectorId },
        data: { assignedTo: null },
      });
      return tasksUpdated.count;
    });
    await this.audit.log({
      userId: actor.id, action: 'customer_unassigned', entityTable: 'customers', entityId: id,
      oldValue: { collectorId: current.collectorId },
      newValue: { effectiveTo: today, tasksUnassigned: result }, req,
    });
    return {
      unassigned: true,
      collectorId: current.collectorId,
      collectorName: current.collector.user.fullName,
      tasksUpdated: result,
    };
  }

  // --------------------------------------------------------------------------
  // حالات تشابه الأسماء — مراجعة بشرية فقط، لا دمج آلي
  // --------------------------------------------------------------------------
  async listDuplicates(actor: AuthUser) {
    return this.prisma.potentialDuplicateCustomer.findMany({
      where: {
        reviewStatus: 'pending',
        customerA: { organizationId: actor.organizationId },
        customerB: { organizationId: actor.organizationId },
      },
      include: {
        customerA: {
          select: {
            id: true, externalCustomerCode: true, name: true, phonePrimary: true, whatsapp: true,
            balances: { select: { currencyCode: true, accountingBalance: true } },
            _count: { select: { importedTxns: true, followups: true, promises: true, collections: true, reservations: true, tasks: true } },
          },
        },
        customerB: {
          select: {
            id: true, externalCustomerCode: true, name: true, phonePrimary: true, whatsapp: true,
            balances: { select: { currencyCode: true, accountingBalance: true } },
            _count: { select: { importedTxns: true, followups: true, promises: true, collections: true, reservations: true, tasks: true } },
          },
        },
      },
    });
  }

  async updateCreditPolicy(
    actor: AuthUser, id: string, dto: UpdateCreditPolicyDto, req?: Request,
  ) {
    await this.assertAccess(actor, id);
    if (!actor.permissions.includes('customers.write')) {
      throw new ForbiddenException('تعديل السياسة الائتمانية يتطلب صلاحية customers.write');
    }
    const before = await this.prisma.customerCreditPolicy.findUnique({ where: { customerId: id } });
    const currencyCode = dto.creditLimitCurrency ?? before?.creditLimitCurrency ?? null;
    const amount = dto.creditLimitAmount === undefined
      ? before?.creditLimitAmount ?? null
      : dto.creditLimitAmount;
    if (amount != null && !currencyCode) {
      throw new BadRequestException('حدد عملة حد الائتمان عند إدخال قيمة الحد');
    }
    if (currencyCode) {
      const currency = await this.prisma.currency.findFirst({
        where: { code: currencyCode, active: true },
      });
      if (!currency) throw new BadRequestException('عملة حد الائتمان غير معروفة أو معطلة');
    }
    const data = {
      ...dto,
      ...(dto.creditLimitAmount === null ? { creditLimitCurrency: null } : {}),
      decidedBy: actor.id,
      decidedAt: new Date(),
    };
    const policy = await this.prisma.customerCreditPolicy.upsert({
      where: { customerId: id },
      update: data,
      create: {
        customerId: id,
        allowCreditSale: dto.allowCreditSale ?? false,
        allowPurchaseWithDebt: dto.allowPurchaseWithDebt ?? false,
        defaultPaymentDays: dto.defaultPaymentDays ?? null,
        creditLimitAmount: dto.creditLimitAmount ?? null,
        creditLimitCurrency: dto.creditLimitAmount == null ? null : dto.creditLimitCurrency,
        creditStatus: dto.creditStatus ?? 'open',
        restrictionReason: dto.restrictionReason ?? null,
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'credit_policy_updated',
      entityTable: 'customer_credit_policies',
      entityId: id,
      oldValue: before ? JSON.parse(JSON.stringify(before)) : null,
      newValue: JSON.parse(JSON.stringify(policy)),
      req,
    });
    await this.riskRefresh?.trigger(actor, [id], 'credit_policy_changed', req);
    return policy;
  }

  async listMerges(actor: AuthUser) {
    return this.prisma.customerMerge.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { mergedAt: 'desc' },
      take: 50,
      select: {
        id: true, status: true, mergedAt: true, reversibleUntil: true, reversedAt: true,
        master: { select: { id: true, name: true, externalCustomerCode: true } },
        source: { select: { id: true, name: true, externalCustomerCode: true } },
        creator: { select: { fullName: true } },
        reverser: { select: { fullName: true } },
      },
    });
  }

  // --------------------------------------------------------------------------
  // Data Quality Dashboard: read-only counts from existing data only.
  // No merge/delete/edit here — review stays a separate human decision (reviewDuplicate).
  // --------------------------------------------------------------------------
  async dataQuality(actor: AuthUser) {
    const orgId = actor.organizationId;

    const [missingPhone, pendingDuplicatePairs, currencyGroups, balances, unclassifiedReservationUnits] = await Promise.all([
      this.prisma.customer.count({
        where: { organizationId: orgId, OR: [{ phonePrimary: null }, { phonePrimary: '' }] },
      }),
      this.prisma.potentialDuplicateCustomer.count({
        where: { reviewStatus: 'pending', customerA: { organizationId: orgId } },
      }),
      this.prisma.customerBalance.groupBy({
        by: ['customerId'],
        where: { customer: { organizationId: orgId } },
        _count: { currencyCode: true },
      }),
      this.prisma.customerBalance.findMany({
        where: {
          customer: { organizationId: orgId },
          declaredBalance: { not: null },
        },
        select: { accountingBalance: true, declaredBalance: true },
      }),
      this.prisma.reservation.count({
        where: {
          customer: { organizationId: orgId },
          unit: { not: null },
          unitId: null,
        },
      }),
    ]);

    const multiCurrencyCustomers = currencyGroups.filter((g) => g._count.currencyCode > 1).length;
    const suspiciousBalances = balances.filter(
      (b) => b.declaredBalance !== null && Number(b.declaredBalance) !== Number(b.accountingBalance),
    ).length;

    return {
      missingPhone,
      pendingDuplicatePairs,
      multiCurrencyCustomers,
      suspiciousBalances,
      unclassifiedReservationUnits,
    };
  }

  async reviewDuplicate(actor: AuthUser, pairId: string, decision: string, req?: Request) {
    const pair = await this.prisma.potentialDuplicateCustomer.findFirst({
      where: { id: pairId, customerA: { organizationId: actor.organizationId } },
    });
    if (!pair) throw new NotFoundException('حالة التشابه غير موجودة');
    if (pair.reviewStatus !== 'pending') {
      throw new ConflictException('هذه الحالة روجعت مسبقًا');
    }
    const updated = await this.prisma.potentialDuplicateCustomer.update({
      where: { id: pairId },
      data: { reviewStatus: decision, reviewedBy: actor.id, reviewedAt: new Date() },
    });
    await this.audit.log({
      userId: actor.id, action: 'duplicate_reviewed', entityTable: 'potential_duplicate_customers',
      entityId: pairId, newValue: { decision }, req,
    });
    return updated;
  }

  async mergeDuplicate(actor: AuthUser, pairId: string, dto: MergeDuplicateDto, req?: Request) {
    const now = new Date();
    const reversibleUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const pair = await tx.potentialDuplicateCustomer.findFirst({
        where: { id: pairId, reviewStatus: 'pending', customerA: { organizationId: actor.organizationId } },
      });
      if (!pair) throw new NotFoundException('حالة التشابه غير موجودة أو تمت مراجعتها');
      if (![pair.customerAId, pair.customerBId].includes(dto.masterCustomerId)) {
        throw new BadRequestException('العميل الأساسي يجب أن يكون أحد طرفي حالة التشابه');
      }

      const sourceCustomerId = pair.customerAId === dto.masterCustomerId
        ? pair.customerBId
        : pair.customerAId;
      const [master, source] = await Promise.all([
        tx.customer.findFirst({
          where: { id: dto.masterCustomerId, organizationId: actor.organizationId },
          include: { balances: true, creditPolicy: true },
        }),
        tx.customer.findFirst({
          where: { id: sourceCustomerId, organizationId: actor.organizationId },
          include: { balances: true, creditPolicy: true },
        }),
      ]);
      if (!master || !source) throw new NotFoundException('أحد سجلي العميل غير موجود');
      if (master.mergedIntoId || source.mergedIntoId || master.status === 'merged' || source.status === 'merged') {
        throw new ConflictException('لا يمكن دمج سجل مؤرشف أو مدمج مسبقًا');
      }
      if (master.creditPolicy && source.creditPolicy) {
        throw new ConflictException('لكلا العميلين سياسة ائتمانية. راجع السياسة واختر واحدة قبل الدمج');
      }

      const sourceReconciliations = await tx.balanceReconciliation.findMany({
        where: { customerId: source.id },
        select: { importJobId: true, currencyCode: true },
      });
      if (sourceReconciliations.length) {
        const collision = await tx.balanceReconciliation.findFirst({
          where: {
            customerId: master.id,
            OR: sourceReconciliations.map((r) => ({ importJobId: r.importJobId, currencyCode: r.currencyCode })),
          },
        });
        if (collision) {
          throw new ConflictException('يوجد تعارض تسوية لنفس دفعة الاستيراد والعملة؛ يجب مراجعته قبل الدمج');
        }
      }

      const [
        importedTransactions, balanceSnapshots, ledgerEntries, reconciliations, collections,
        followups, promises, tasks, reservations, scores, agingRows, agingDocuments,
        assignments, attachments, gpsLogs, duplicatePairs,
      ] = await Promise.all([
        tx.importedTransaction.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.balanceSnapshot.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.operationalLedger.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.balanceReconciliation.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.collection.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.followup.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.paymentPromise.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.task.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.reservation.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.customerScore.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.debtAgingSummary.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.debtAgingDetail.findMany({ where: { customerId: source.id }, select: { id: true } }),
        tx.customerAssignment.findMany({ where: { customerId: source.id }, select: { id: true, effectiveTo: true } }),
        tx.attachment.findMany({ where: { entityTable: 'customers', entityId: source.id }, select: { id: true } }),
        tx.gpsLog.findMany({ where: { entityTable: 'customers', entityId: source.id }, select: { id: true } }),
        tx.potentialDuplicateCustomer.findMany({
          where: {
            reviewStatus: 'pending',
            OR: [{ customerAId: source.id }, { customerBId: source.id }],
          },
          select: { id: true },
        }),
      ]);

      const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id);
      const movedIds = {
        importedTransactions: ids(importedTransactions), balanceSnapshots: ids(balanceSnapshots),
        ledgerEntriesPreserved: ids(ledgerEntries), reconciliations: ids(reconciliations), collections: ids(collections),
        followups: ids(followups), promises: ids(promises), tasks: ids(tasks), reservations: ids(reservations),
        scores: ids(scores), agingRows: ids(agingRows), agingDocuments: ids(agingDocuments),
        assignments: ids(assignments), attachments: ids(attachments), gpsLogs: ids(gpsLogs),
      };

      const masterBalanceBefore = master.balances.map((b) => ({
        id: b.id, openingDebit: b.openingDebit.toString(), openingCredit: b.openingCredit.toString(),
        accountingBalance: b.accountingBalance.toString(),
        declaredBalance: b.declaredBalance?.toString() ?? null,
        declaredLabel: b.declaredLabel, lastImportJobId: b.lastImportJobId,
        updatedAt: b.updatedAt.toISOString(), currencyCode: b.currencyCode,
      }));
      const movedBalanceIds: string[] = [];
      const mergedBalanceExpected: Array<{ id: string; accountingBalance: string; openingDebit: string; openingCredit: string }> = [];
      const ledgerTransferByCurrency: Array<{ currencyCode: string; amount: string }> = [];
      const masterByCurrency = new Map(master.balances.map((b) => [b.currencyCode, b]));
      for (const sourceBalance of source.balances) {
        if (sourceBalance.lastImportJobId) {
          const sourceImport = await tx.importJob.findUnique({
            where: { id: sourceBalance.lastImportJobId }, select: { importedAt: true },
          });
          if (sourceImport) {
            const delta = await tx.operationalLedger.aggregate({
              where: {
                customerId: source.id, currencyCode: sourceBalance.currencyCode,
                createdAt: { gt: sourceImport.importedAt },
              },
              _sum: { amountSigned: true },
            });
            if (delta._sum.amountSigned && !delta._sum.amountSigned.isZero()) {
              ledgerTransferByCurrency.push({
                currencyCode: sourceBalance.currencyCode, amount: delta._sum.amountSigned.toString(),
              });
            }
          }
        }
        const masterBalance = masterByCurrency.get(sourceBalance.currencyCode);
        if (!masterBalance) {
          await tx.customerBalance.update({ where: { id: sourceBalance.id }, data: { customerId: master.id } });
          movedBalanceIds.push(sourceBalance.id);
          mergedBalanceExpected.push({
            id: sourceBalance.id, accountingBalance: sourceBalance.accountingBalance.toString(),
            openingDebit: sourceBalance.openingDebit.toString(), openingCredit: sourceBalance.openingCredit.toString(),
          });
          continue;
        }
        const openingDebit = masterBalance.openingDebit.plus(sourceBalance.openingDebit);
        const openingCredit = masterBalance.openingCredit.plus(sourceBalance.openingCredit);
        const accountingBalance = masterBalance.accountingBalance.plus(sourceBalance.accountingBalance);
        const declaredBalance = masterBalance.declaredBalance === null && sourceBalance.declaredBalance === null
          ? null
          : (masterBalance.declaredBalance ?? new Prisma.Decimal(0))
              .plus(sourceBalance.declaredBalance ?? new Prisma.Decimal(0));
        await tx.customerBalance.update({
          where: { id: masterBalance.id },
          data: {
            openingDebit, openingCredit, accountingBalance, declaredBalance,
            declaredLabel: masterBalance.declaredLabel ?? sourceBalance.declaredLabel,
            // Keep the master's accounting cut-off. Source post-import ledger delta is
            // transferred below as an append-only entry, so no historical row is mutated.
            lastImportJobId: masterBalance.lastImportJobId,
            updatedAt: now,
          },
        });
        mergedBalanceExpected.push({
          id: masterBalance.id, accountingBalance: accountingBalance.toString(),
          openingDebit: openingDebit.toString(), openingCredit: openingCredit.toString(),
        });
      }

      const masterOpenAssignment = await tx.customerAssignment.findFirst({
        where: { customerId: master.id, effectiveTo: null }, select: { id: true },
      });
      const sourceOpenAssignment = assignments.find((a) => a.effectiveTo === null) ?? null;
      if (masterOpenAssignment && sourceOpenAssignment) {
        await tx.customerAssignment.update({
          where: { id: sourceOpenAssignment.id }, data: { effectiveTo: now },
        });
      }

      const move = async (model: any, rowIds: string[]) => {
        if (rowIds.length) await model.updateMany({ where: { id: { in: rowIds } }, data: { customerId: master.id } });
      };
      await move(tx.importedTransaction, movedIds.importedTransactions);
      await move(tx.balanceSnapshot, movedIds.balanceSnapshots);
      await move(tx.balanceReconciliation, movedIds.reconciliations);
      await move(tx.collection, movedIds.collections);
      await move(tx.followup, movedIds.followups);
      await move(tx.paymentPromise, movedIds.promises);
      await move(tx.task, movedIds.tasks);
      await move(tx.reservation, movedIds.reservations);
      await move(tx.customerScore, movedIds.scores);
      await move(tx.debtAgingSummary, movedIds.agingRows);
      await move(tx.debtAgingDetail, movedIds.agingDocuments);
      await move(tx.customerAssignment, movedIds.assignments);
      if (movedIds.attachments.length) {
        await tx.attachment.updateMany({ where: { id: { in: movedIds.attachments } }, data: { entityId: master.id } });
      }
      if (movedIds.gpsLogs.length) {
        await tx.gpsLog.updateMany({ where: { id: { in: movedIds.gpsLogs } }, data: { entityId: master.id } });
      }

      const movedCreditPolicy = Boolean(source.creditPolicy && !master.creditPolicy);
      const movedCreditPolicyExpected = movedCreditPolicy
        ? JSON.parse(JSON.stringify({ ...source.creditPolicy, customerId: master.id }))
        : null;
      if (movedCreditPolicy) {
        await tx.customerCreditPolicy.update({ where: { customerId: source.id }, data: { customerId: master.id } });
      }

      const restorePayload = JSON.parse(JSON.stringify({
        sourceBefore: { status: source.status, mergedIntoId: source.mergedIntoId, mergedAt: source.mergedAt },
        movedIds, movedBalanceIds, masterBalanceBefore, mergedBalanceExpected, movedCreditPolicy,
        ledgerTransferByCurrency, movedCreditPolicyExpected,
        sourceOpenAssignmentId: masterOpenAssignment ? sourceOpenAssignment?.id ?? null : null,
        duplicatePairIds: ids(duplicatePairs),
      })) as Prisma.InputJsonValue;
      const merge = await tx.customerMerge.create({
        data: {
          organizationId: actor.organizationId, masterCustomerId: master.id, sourceCustomerId: source.id,
          pairId, restorePayload, mergedBy: actor.id, mergedAt: now, reversibleUntil,
        },
      });
      for (const transfer of ledgerTransferByCurrency) {
        await tx.operationalLedger.create({
          data: {
            customerId: master.id, currencyCode: transfer.currencyCode,
            entryType: 'customer_merge_transfer',
            amountSigned: transfer.amount, sourceTable: `customer_merges:${transfer.currencyCode}`, sourceId: merge.id,
            createdBy: actor.id,
          },
        });
      }

      const aliasCandidates = [
        ['external_code', source.externalCustomerCode], ['name', source.name],
        ['phone', source.phonePrimary], ['phone', source.phoneSecondary], ['whatsapp', source.whatsapp],
      ].filter((entry): entry is [string, string] => Boolean(entry[1]));
      if (aliasCandidates.length) {
        await tx.customerAlias.createMany({
          data: aliasCandidates.map(([aliasType, aliasValue]) => ({
            organizationId: actor.organizationId, customerId: master.id, sourceCustomerId: source.id,
            mergeId: merge.id, aliasType, aliasValue, aliasNormalized: normalizeAlias(aliasValue),
          })),
          skipDuplicates: true,
        });
      }

      await tx.potentialDuplicateCustomer.updateMany({
        where: { id: { in: ids(duplicatePairs) } },
        data: { reviewStatus: 'merged', reviewedBy: actor.id, reviewedAt: now },
      });
      await tx.customer.update({
        where: { id: source.id }, data: { status: 'merged', mergedIntoId: master.id, mergedAt: now },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id, action: 'customer_merged', entityTable: 'customer_merges', entityId: merge.id,
          oldValue: { masterCustomerId: master.id, sourceCustomerId: source.id },
          newValue: { movedCounts: Object.fromEntries(Object.entries(movedIds).map(([k, v]) => [k, v.length])), reversibleUntil },
          reason: dto.reason ?? null, ipAddress: req?.ip ?? null,
          userAgent: (req?.headers['user-agent'] as string) ?? null,
        },
      });

      return {
        mergeId: merge.id, masterCustomerId: master.id, sourceCustomerId: source.id,
        reversibleUntil, movedCounts: Object.fromEntries(Object.entries(movedIds).map(([k, v]) => [k, v.length])),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  }

  async reverseMerge(actor: AuthUser, mergeId: string, dto: ReverseCustomerMergeDto, req?: Request) {
    return this.prisma.$transaction(async (tx) => {
      const merge = await tx.customerMerge.findFirst({
        where: { id: mergeId, organizationId: actor.organizationId },
      });
      if (!merge) throw new NotFoundException('عملية الدمج غير موجودة');
      if (merge.status !== 'active') throw new ConflictException('تم التراجع عن هذه العملية مسبقًا');
      if (merge.reversibleUntil.getTime() < Date.now()) {
        throw new ConflictException('انتهت مهلة التراجع البالغة 24 ساعة');
      }

      const payload = merge.restorePayload as any;
      for (const expected of payload.mergedBalanceExpected ?? []) {
        const current = await tx.customerBalance.findUnique({ where: { id: expected.id } });
        if (!current
          || current.accountingBalance.toString() !== expected.accountingBalance
          || current.openingDebit.toString() !== expected.openingDebit
          || current.openingCredit.toString() !== expected.openingCredit) {
          throw new ConflictException('تغير رصيد العميل الأساسي بعد الدمج؛ أوقف التراجع وراجعه محاسبيًا');
        }
      }
      if (payload.movedCreditPolicyExpected) {
        const currentPolicy = await tx.customerCreditPolicy.findUnique({
          where: { customerId: merge.masterCustomerId },
        });
        if (JSON.stringify(currentPolicy) !== JSON.stringify(payload.movedCreditPolicyExpected)) {
          throw new ConflictException('تغيرت السياسة الائتمانية بعد الدمج؛ أوقف التراجع وراجعها يدويًا');
        }
      }

      const moved = payload.movedIds as Record<string, string[]>;
      const restore = async (model: any, rowIds: string[] = []) => {
        if (rowIds.length) await model.updateMany({ where: { id: { in: rowIds } }, data: { customerId: merge.sourceCustomerId } });
      };
      await restore(tx.importedTransaction, moved.importedTransactions);
      await restore(tx.balanceSnapshot, moved.balanceSnapshots);
      await restore(tx.balanceReconciliation, moved.reconciliations);
      await restore(tx.collection, moved.collections);
      await restore(tx.followup, moved.followups);
      await restore(tx.paymentPromise, moved.promises);
      await restore(tx.task, moved.tasks);
      await restore(tx.reservation, moved.reservations);
      await restore(tx.customerScore, moved.scores);
      await restore(tx.debtAgingSummary, moved.agingRows);
      await restore(tx.debtAgingDetail, moved.agingDocuments);
      await restore(tx.customerAssignment, moved.assignments);
      if (payload.sourceOpenAssignmentId) {
        await tx.customerAssignment.update({ where: { id: payload.sourceOpenAssignmentId }, data: { effectiveTo: null } });
      }
      if ((payload.movedBalanceIds as string[]).length) {
        await tx.customerBalance.updateMany({
          where: { id: { in: payload.movedBalanceIds } }, data: { customerId: merge.sourceCustomerId },
        });
      }
      for (const balance of payload.masterBalanceBefore ?? []) {
        await tx.customerBalance.update({
          where: { id: balance.id },
          data: {
            openingDebit: balance.openingDebit, openingCredit: balance.openingCredit,
            accountingBalance: balance.accountingBalance, declaredBalance: balance.declaredBalance,
            declaredLabel: balance.declaredLabel, lastImportJobId: balance.lastImportJobId,
            updatedAt: new Date(balance.updatedAt),
          },
        });
      }
      if (payload.movedCreditPolicy) {
        await tx.customerCreditPolicy.update({
          where: { customerId: merge.masterCustomerId }, data: { customerId: merge.sourceCustomerId },
        });
      }
      for (const transfer of payload.ledgerTransferByCurrency ?? []) {
        await tx.operationalLedger.create({
          data: {
            customerId: merge.masterCustomerId, currencyCode: transfer.currencyCode,
            entryType: 'customer_merge_reversal',
            amountSigned: new Prisma.Decimal(transfer.amount).negated(),
            sourceTable: `customer_merge_reversals:${transfer.currencyCode}`, sourceId: merge.id, createdBy: actor.id,
          },
        });
      }
      if (moved.attachments?.length) {
        await tx.attachment.updateMany({ where: { id: { in: moved.attachments } }, data: { entityId: merge.sourceCustomerId } });
      }
      if (moved.gpsLogs?.length) {
        await tx.gpsLog.updateMany({ where: { id: { in: moved.gpsLogs } }, data: { entityId: merge.sourceCustomerId } });
      }
      if (payload.duplicatePairIds?.length) {
        await tx.potentialDuplicateCustomer.updateMany({
          where: { id: { in: payload.duplicatePairIds } },
          data: { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null },
        });
      }
      await tx.customerAlias.deleteMany({ where: { mergeId } });
      await tx.customer.update({
        where: { id: merge.sourceCustomerId },
        data: {
          status: payload.sourceBefore.status,
          mergedIntoId: payload.sourceBefore.mergedIntoId,
          mergedAt: payload.sourceBefore.mergedAt ? new Date(payload.sourceBefore.mergedAt) : null,
        },
      });
      await tx.customerMerge.update({
        where: { id: mergeId }, data: { status: 'reversed', reversedBy: actor.id, reversedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id, action: 'customer_merge_reversed', entityTable: 'customer_merges', entityId: mergeId,
          oldValue: { status: 'active' }, newValue: { status: 'reversed' }, reason: dto.reason ?? null,
          ipAddress: req?.ip ?? null, userAgent: (req?.headers['user-agent'] as string) ?? null,
        },
      });
      return { mergeId, reversed: true, masterCustomerId: merge.masterCustomerId, sourceCustomerId: merge.sourceCustomerId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  }
}
