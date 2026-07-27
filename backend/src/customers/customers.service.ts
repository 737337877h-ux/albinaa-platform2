import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AssignCollectorDto } from './dto/assign-collector.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

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

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
      ];
    }
    if (q.region) where.region = q.region;
    if (q.branchId) where.branchId = q.branchId;
    if (q.status) where.status = q.status;
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
          where: { customerId: id },
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
    if (!balance) throw new NotFoundException(`لا يوجد حساب بعملة ${q.currency} لهذا العميل`);

    const baseWhere: Prisma.ImportedTransactionWhereInput = {
      customerId: id, currencyCode: q.currency,
    };
    const rangeWhere: Prisma.ImportedTransactionWhereInput = { ...baseWhere };
    if (q.fromDate || q.toDate) {
      rangeWhere.txDate = {};
      if (q.fromDate) (rangeWhere.txDate as any).gte = new Date(q.fromDate);
      if (q.toDate) (rangeWhere.txDate as any).lte = new Date(q.toDate);
    }

    // رصيد بداية الفترة = الافتتاحي + كل الحركات السابقة لبداية الفترة
    const opening = Number(balance.openingDebit) - Number(balance.openingCredit);
    let startBalance = opening;
    if (q.fromDate) {
      const prior = await this.prisma.importedTransaction.aggregate({
        _sum: { debit: true, credit: true },
        where: { ...baseWhere, txDate: { lt: new Date(q.fromDate) } },
      });
      startBalance += Number(prior._sum.debit ?? 0) - Number(prior._sum.credit ?? 0);
    }

    const total = await this.prisma.importedTransaction.count({ where: rangeWhere });
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
      currentBalance: Number(balance.accountingBalance),
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
      return tx.customerAssignment.create({
        data: {
          customerId: id,
          collectorId: dto.collectorId,
          effectiveFrom,
          reason: dto.reason,
          assignedBy: actor.id,
        },
      });
    });

    await this.audit.log({
      userId: actor.id, action: 'customer_reassigned', entityTable: 'customers', entityId: id,
      oldValue: { collectorId: current?.collectorId ?? null },
      newValue: { collectorId: dto.collectorId, reason: dto.reason }, req,
    });
    return { assignment: result, collectorName: collector.user.fullName };
  }

  // --------------------------------------------------------------------------
  // حالات تشابه الأسماء — مراجعة بشرية فقط، لا دمج آلي
  // --------------------------------------------------------------------------
  async listDuplicates(actor: AuthUser) {
    return this.prisma.potentialDuplicateCustomer.findMany({
      where: {
        reviewStatus: 'pending',
        customerA: { organizationId: actor.organizationId },
      },
      include: {
        customerA: {
          select: {
            id: true, externalCustomerCode: true, name: true,
            balances: { select: { currencyCode: true, accountingBalance: true } },
          },
        },
        customerB: {
          select: {
            id: true, externalCustomerCode: true, name: true,
            balances: { select: { currencyCode: true, accountingBalance: true } },
          },
        },
      },
    });
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
}
