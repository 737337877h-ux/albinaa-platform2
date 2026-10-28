import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalesOrderDraftDto } from './dto/create-sales-order-draft.dto';
import { ProcessSalesOrderDraftDto } from './dto/process-sales-order-draft.dto';
import { UpdateSalesOrderDraftDto } from './dto/update-sales-order-draft.dto';
import { OracleCustomerOrder, OracleCustomerOrdersReader } from './oracle-customer-orders.reader';
import { ListSalesOrderDraftsQueryDto } from './dto/list-sales-order-drafts-query.dto';

@Injectable()
export class SalesOrderDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly oracleOrders?: OracleCustomerOrdersReader,
  ) {}

  private readonly include = { lines: { orderBy: { lineNo: 'asc' as const } } };

  async list(actor: AuthUser, query: ListSalesOrderDraftsQueryDto = new ListSalesOrderDraftsQueryDto()) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const search = query.search?.trim();
    const where = {
      organizationId: actor.organizationId,
      ...(query.kind && query.kind !== 'all' ? { orderKind: query.kind } : {}),
      ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
      ...(search ? { OR: [
        { sourceOrderNo: { contains: search, mode: 'insensitive' } },
        { sourceOrderSerial: { contains: search, mode: 'insensitive' } },
        { sourceCustomerCode: { contains: search, mode: 'insensitive' } },
        { sourceCustomerName: { contains: search, mode: 'insensitive' } },
      ] } : {}),
    };
    const [total, items] = await Promise.all([
      (this.prisma as any).salesOrderDraft.count({ where }),
      (this.prisma as any).salesOrderDraft.findMany({
        where,
        include: this.include,
        orderBy: [{ sourceOrderDate: 'desc' }, { sourceOrderSerial: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { page, limit, total, totalPages: Math.ceil(total / limit), items };
  }

  async offline(actor: AuthUser) {
    const items = await (this.prisma as any).salesOrderDraft.findMany({
      where: {
        organizationId: actor.organizationId,
        sourceSchema: { in: ['IAS20261', 'PLATFORM'] },
        status: { not: 'cancelled' },
      },
      include: this.include,
      orderBy: [{ sourceOrderDate: 'desc' }, { sourceOrderSerial: 'desc' }],
      take: 5000,
    });
    return {
      sourceSchema: 'IAS20261_AND_PLATFORM',
      generatedAt: new Date().toISOString(),
      items,
    };
  }

  async get(actor: AuthUser, id: string) {
    const draft = await (this.prisma as any).salesOrderDraft.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: this.include,
    });
    if (!draft) throw new NotFoundException('مسودة طلب العميل غير موجودة');
    return draft;
  }

  private normalizedCurrency(value: string | null) {
    const currency = value?.trim().toUpperCase() || 'YER';
    if (currency === 'YR') return 'YER';
    if (currency === 'SR' || currency === 'R S') return 'SAR';
    if (currency === '$') return 'USD';
    return currency;
  }

  private decimal(value: string | null | undefined, fallback = '0') {
    try { return new Prisma.Decimal(value ?? fallback); } catch { return new Prisma.Decimal(fallback); }
  }

  private async mirrorOraclePage(actor: AuthUser, orders: OracleCustomerOrder[]) {
    const creditCodes = [...new Set(orders
      .filter((order) => order.kind === 'credit' && order.customerCode)
      .map((order) => order.customerCode as string))];
    const customers = creditCodes.length ? await this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId, externalCustomerCode: { in: creditCodes } },
      select: { externalCustomerCode: true, name: true },
    }) : [];
    const customerByCode = new Map(customers.map((customer) => [customer.externalCustomerCode, customer]));
    let created = 0; let updated = 0; let blocked = 0;
    for (const order of orders) {
      const linkedCustomer = order.customerCode ? customerByCode.get(order.customerCode) : null;
      const issueCodes: string[] = [];
      let bindingStatus = order.customerBindingStatus;
      if (order.kind === 'credit' && !order.customerCode) issueCodes.push('CREDIT_CUSTOMER_CODE_REQUIRED');
      if (order.kind === 'credit' && order.customerCode && !linkedCustomer) {
        bindingStatus = 'customer_code_not_in_platform';
        issueCodes.push('CUSTOMER_CODE_NOT_IN_PLATFORM');
      }
      if (order.kind === 'cash' && !order.customerName) issueCodes.push('CASH_CUSTOMER_NAME_REQUIRED');
      const usableLines = order.lines.filter((line) => this.decimal(line.quantity).greaterThan(0));
      if (usableLines.length === 0) issueCodes.push('ORDER_HAS_NO_POSITIVE_LINES');
      const validationStatus = issueCodes.some((code) => code.endsWith('_REQUIRED')) ? 'blocked'
        : issueCodes.length ? 'warning' : 'ready';
      if (validationStatus === 'blocked') blocked += 1;
      const lineData = usableLines.map((line) => ({
        lineNo: line.lineNo,
        itemCode: line.itemCode,
        itemName: line.itemName,
        unitCode: line.unitCode || 'غير محدد',
        packageSize: this.decimal(line.packageSize, '1'),
        quantity: this.decimal(line.quantity),
        sourcePrice: this.decimal(line.unitPrice),
        sourceWarehouseCode: line.warehouseCode,
        proposedWarehouseCode: line.warehouseCode,
        originalAvailableQty: null,
        totalAvailableQty: new Prisma.Decimal(0),
        validationStatus: line.cancelled ? 'blocked' : 'ready',
        issues: line.cancelled ? ['SOURCE_LINE_CANCELLED'] : [],
        alternativeWarehouses: [],
      }));
      const common = {
        sourceOrderNo: order.orderNo,
        sourceOrderDate: new Date(`${order.orderDate}T00:00:00Z`),
        sourceCustomerCode: order.customerCode,
        sourceCustomerName: order.customerName,
        sourceCustomerMobile: order.customerMobile,
        sourceCustomerAddress: order.customerAddress,
        proposedCustomerCode: order.customerCode,
        proposedCustomerName: linkedCustomer?.name ?? order.customerName,
        currencyCode: this.normalizedCurrency(order.currencyCode),
        sourceAmount: this.decimal(order.amount),
        billDocumentType: order.billDocumentType,
        orderKind: order.kind,
        customerBindingStatus: bindingStatus,
        sourceApproved: order.approved,
        sourceProcessed: order.processed,
        sourceUpdatedAt: order.updatedAt ? new Date(`${order.updatedAt.replace(' ', 'T')}Z`) : null,
        syncedAt: new Date(),
        validationStatus,
        validationSummary: {
          issueCodes,
          totalSourceLines: order.lines.length,
          storedLines: lineData.length,
          customerCodeRequired: order.kind === 'credit',
          oracleWrite: 'NONE',
          sourceSchema: 'IAS20261',
        },
        oracleWriteEnabled: false,
      };
      const existing = await (this.prisma as any).salesOrderDraft.findUnique({
        where: { organizationId_sourceSchema_sourceOrderSerial: {
          organizationId: actor.organizationId, sourceSchema: 'IAS20261', sourceOrderSerial: order.orderSerial,
        } },
        select: { id: true },
      });
      await (this.prisma as any).salesOrderDraft.upsert({
        where: { organizationId_sourceSchema_sourceOrderSerial: {
          organizationId: actor.organizationId, sourceSchema: 'IAS20261', sourceOrderSerial: order.orderSerial,
        } },
        create: {
          organizationId: actor.organizationId,
          sourceSchema: 'IAS20261',
          sourceOrderSerial: order.orderSerial,
          createdBy: actor.id,
          ...common,
          lines: { create: lineData },
        },
        update: {
          ...common,
          lines: { deleteMany: {}, create: lineData },
        },
      });
      existing ? updated += 1 : created += 1;
    }
    return { created, updated, blocked };
  }

  async syncOracle(actor: AuthUser, req: Request) {
    if (!this.oracleOrders) throw new BadRequestException('قارئ طلبات Oracle غير مهيأ');
    let afterSerial: string | null = null;
    let pageCount = 0; let total = 0; let created = 0; let updated = 0; let blocked = 0;
    do {
      // Oracle 11g on this host becomes unstable with a 200-value detail IN
      // list. Fifty keeps each SELECT bounded while still completing the
      // current 2.2k-order mirror in fewer than 50 pages.
      const page = await this.oracleOrders.page(afterSerial, 50);
      const mirrored = await this.mirrorOraclePage(actor, page.items);
      total += page.items.length;
      created += mirrored.created; updated += mirrored.updated; blocked += mirrored.blocked;
      pageCount += 1;
      if (page.nextAfterSerial && page.nextAfterSerial === afterSerial) {
        throw new BadRequestException('توقف مؤشر مزامنة طلبات Oracle عن التقدم');
      }
      afterSerial = page.nextAfterSerial;
      if (pageCount > 50) throw new BadRequestException('تجاوزت مزامنة طلبات Oracle الحد الآمن للصفحات');
    } while (afterSerial);
    const result = { mode: 'SELECT_ONLY', oracleWrite: 'NONE', sourceSchema: 'IAS20261', pageCount, total, created, updated, blocked };
    await this.audit.log({
      userId: actor.id,
      action: 'oracle_customer_orders_synced',
      entityTable: 'sales_order_drafts',
      entityId: actor.organizationId,
      newValue: result,
      req,
    });
    return result;
  }

  async mirrorCreatedOrder(actor: AuthUser, serial: string) {
    if (!this.oracleOrders) throw new BadRequestException('قارئ طلبات Oracle غير مهيأ');
    const order = await this.oracleOrders.get(serial);
    await this.mirrorOraclePage(actor, [order]);
    return (this.prisma as any).salesOrderDraft.findUniqueOrThrow({
      where: { organizationId_sourceSchema_sourceOrderSerial: {
        organizationId: actor.organizationId, sourceSchema: 'IAS20261', sourceOrderSerial: serial,
      } }, include: this.include,
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateSalesOrderDraftDto, req: Request) {
    const current = await this.get(actor, id);
    const updated = await (this.prisma as any).salesOrderDraft.update({
      where: { id },
      data: {
        ...(dto.proposedCustomerCode !== undefined ? { proposedCustomerCode: dto.proposedCustomerCode.trim() || null } : {}),
        ...(dto.proposedCustomerName !== undefined ? { proposedCustomerName: dto.proposedCustomerName.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: this.include,
    });
    await this.audit.log({
      userId: actor.id, action: 'sales_order_draft_updated', entityTable: 'sales_order_drafts', entityId: id,
      oldValue: { status: current.status, proposedCustomerCode: current.proposedCustomerCode },
      newValue: { status: updated.status, proposedCustomerCode: updated.proposedCustomerCode, oracleWrite: 'NONE' }, req,
    });
    return updated;
  }

  async process(actor: AuthUser, id: string, dto: ProcessSalesOrderDraftDto, req: Request) {
    const current = await this.get(actor, id);
    if (dto.status === 'ready_for_approval' && current.validationStatus === 'blocked') {
      throw new BadRequestException('لا يمكن تجهيز الطلب قبل معالجة أخطاء ربط العميل');
    }
    const reason = dto.reason?.trim();
    const notes = reason ? [current.notes, `معالجة المنصة: ${reason}`].filter(Boolean).join('\n') : current.notes;
    const updated = await (this.prisma as any).salesOrderDraft.update({
      where: { id }, data: { status: dto.status, notes }, include: this.include,
    });
    await this.audit.log({
      userId: actor.id, action: 'sales_order_draft_processed', entityTable: 'sales_order_drafts', entityId: id,
      oldValue: { status: current.status }, newValue: { status: dto.status, reason: reason ?? null, oracleWrite: 'NONE' }, req,
    });
    return updated;
  }

  private async latestCustomerRun(organizationId: string) {
    const run = await this.prisma.oracleCustomerSyncRun.findFirst({
      where: { organizationId, status: { in: ['validated', 'published', 'validating'] } }, orderBy: { startedAt: 'desc' }, select: { id: true },
    });
    if (!run) throw new BadRequestException('لا توجد لقطة عملاء جاهزة للاختيار في نسخة الاختبار');
    return run.id;
  }

  private async activeInventoryRun(organizationId: string) {
    const active = await this.prisma.oracleInventoryActiveSnapshot.findUnique({
      where: { organizationId_sourceSchema: { organizationId, sourceSchema: 'IAS20261' } },
      select: { activeRunId: true },
    });
    if (!active) throw new BadRequestException('لا توجد لقطة مخزون منشورة في نسخة الاختبار');
    return active.activeRunId;
  }

  async customerCatalog(actor: AuthUser, search: string) {
    const syncRunId = await this.latestCustomerRun(actor.organizationId);
    const term = search.trim();
    return this.prisma.oracleCustomerMirror.findMany({
      where: {
        syncRunId, organizationId: actor.organizationId, isInactive: false,
        ...(term ? { OR: [
          { externalCustomerCode: { contains: term, mode: 'insensitive' as const } },
          { nameAr: { contains: term, mode: 'insensitive' as const } },
          { mobile: { contains: term } },
        ] } : {}),
      },
      select: { externalCustomerCode: true, nameAr: true, mobile: true, phone: true, address: true },
      orderBy: { externalCustomerCode: 'asc' }, take: 30,
    });
  }

  async itemCatalog(actor: AuthUser, search: string) {
    const syncRunId = await this.activeInventoryRun(actor.organizationId);
    const term = search.trim();
    if (term.length < 2) return [];
    const items = await this.prisma.oracleItemMirror.findMany({
      where: {
        syncRunId, organizationId: actor.organizationId, isInactive: false, isService: false,
        OR: [
          { externalItemCode: { contains: term, mode: 'insensitive' } },
          { nameAr: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: {
        externalItemCode: true, nameAr: true,
        units: {
          where: { isInactive: false, noSale: false },
          select: { unitName: true, packageSize: true, isSaleUnit: true, stockRows: {
            where: { isInactive: false },
            select: { externalWarehouseCode: true, availableQuantity: true },
          } },
          orderBy: [{ isSaleUnit: 'desc' }, { unitLevel: 'asc' }],
        },
      },
      orderBy: { externalItemCode: 'asc' }, take: 20,
    });
    return items.map((item) => ({
      code: item.externalItemCode, name: item.nameAr,
      units: item.units.map((unit) => ({
        code: unit.unitName, packageSize: unit.packageSize,
        warehouses: unit.stockRows.map((stock) => ({ code: stock.externalWarehouseCode, available: stock.availableQuantity })),
      })),
    }));
  }

  async warehouseCatalog(actor: AuthUser) {
    const syncRunId = await this.activeInventoryRun(actor.organizationId);
    return this.prisma.oracleWarehouseMirror.findMany({
      where: { syncRunId, organizationId: actor.organizationId, isInactive: false, noSale: false },
      select: { externalWarehouseCode: true, nameAr: true }, orderBy: { externalWarehouseCode: 'asc' },
    });
  }

  private async prepare(actor: AuthUser, dto: CreateSalesOrderDraftDto) {
    const [customerRunId, inventoryRunId] = await Promise.all([
      this.latestCustomerRun(actor.organizationId), this.activeInventoryRun(actor.organizationId),
    ]);
    const customerCode = dto.customerCode?.trim() || null;
    const orderKind = dto.orderKind ?? (customerCode ? 'credit' : 'cash');
    if (orderKind === 'credit' && !customerCode) {
      throw new BadRequestException('رقم العميل مطلوب للطلب الآجل');
    }
    const linkedCustomer = customerCode ? await this.prisma.oracleCustomerMirror.findFirst({
      where: { syncRunId: customerRunId, organizationId: actor.organizationId, externalCustomerCode: customerCode, isInactive: false },
    }) : null;
    if (orderKind === 'credit' && !linkedCustomer) {
      throw new BadRequestException('العميل الآجل غير موجود في لقطة Oracle الحالية');
    }
    const customerName = linkedCustomer?.nameAr || dto.customerName?.trim();
    if (!customerName) throw new BadRequestException('اسم العميل مطلوب للطلب النقدي');
    const customer = {
      externalCustomerCode: linkedCustomer?.externalCustomerCode ?? null,
      nameAr: customerName,
      mobile: linkedCustomer?.mobile ?? null,
      phone: linkedCustomer?.phone ?? null,
      address: linkedCustomer?.address ?? null,
    };

    const lineData: Array<{
      lineNo: number; itemCode: string; itemName: string; unitCode: string; packageSize: Prisma.Decimal;
      quantity: Prisma.Decimal; sourcePrice: Prisma.Decimal; sourceWarehouseCode: string;
      proposedWarehouseCode: string; originalAvailableQty: Prisma.Decimal; totalAvailableQty: Prisma.Decimal;
      validationStatus: string; issues: string[]; alternativeWarehouses: Array<{ code: string; available: string }>;
    }> = [];
    const issueCodes = new Set<string>();
    for (let index = 0; index < dto.lines.length; index += 1) {
      const input = dto.lines[index];
      const itemCode = input.itemCode.trim(); const unitCode = input.unitCode.trim(); const warehouseCode = input.warehouseCode.trim();
      const unit = await this.prisma.oracleItemUnitMirror.findFirst({
        where: { syncRunId: inventoryRunId, organizationId: actor.organizationId, externalItemCode: itemCode, unitName: unitCode, isInactive: false, noSale: false },
        include: { item: { select: { nameAr: true, isInactive: true } }, stockRows: { where: { isInactive: false } } },
      });
      if (!unit || unit.item.isInactive) throw new BadRequestException(`الصنف ${itemCode} أو وحدته غير صالح للبيع في اللقطة الحالية`);
      const original = unit.stockRows.find((row) => row.externalWarehouseCode === warehouseCode)?.availableQuantity ?? new Prisma.Decimal(0);
      const total = unit.stockRows.reduce((sum, row) => sum.add(row.availableQuantity), new Prisma.Decimal(0));
      const requested = new Prisma.Decimal(input.quantity);
      const alternative = unit.stockRows.filter((row) => row.availableQuantity.greaterThanOrEqualTo(requested))
        .sort((a, b) => b.availableQuantity.comparedTo(a.availableQuantity));
      const validationStatus = original.greaterThanOrEqualTo(requested) ? 'ready' : alternative.length ? 'warehouse_review' : 'blocked';
      const issues = validationStatus === 'ready' ? [] : [validationStatus === 'warehouse_review' ? 'SOURCE_WAREHOUSE_REASSIGN_REQUIRED' : 'INSUFFICIENT_TOTAL_STOCK'];
      issues.forEach((code) => issueCodes.add(code));
      lineData.push({
        lineNo: index + 1, itemCode, itemName: unit.item.nameAr, unitCode, packageSize: unit.packageSize,
        quantity: requested, sourcePrice: new Prisma.Decimal(input.unitPrice), sourceWarehouseCode: warehouseCode,
        proposedWarehouseCode: validationStatus === 'warehouse_review' ? alternative[0].externalWarehouseCode : warehouseCode,
        originalAvailableQty: original, totalAvailableQty: total, validationStatus, issues,
        alternativeWarehouses: alternative.map((row) => ({ code: row.externalWarehouseCode, available: row.availableQuantity.toString() })),
      });
    }
    const blocked = lineData.some((line) => line.validationStatus === 'blocked');
    const warning = lineData.some((line) => line.validationStatus === 'warehouse_review');
    const validationStatus = blocked ? 'blocked' : warning ? 'warning' : 'ready';
    const readyLines = lineData.filter((line) => line.validationStatus === 'ready').length;
    const amount = lineData.reduce((sum, line) => sum.add(line.quantity.mul(line.sourcePrice)), new Prisma.Decimal(0));
    return {
      customer,
      orderKind,
      lines: lineData,
      amount,
      validationStatus,
      issueCodes: [...issueCodes],
      readyLines,
    };
  }

  async dryRun(actor: AuthUser, dto: CreateSalesOrderDraftDto) {
    const prepared = await this.prepare(actor, dto);
    return {
      valid: prepared.validationStatus !== 'blocked',
      mode: 'DRY_RUN',
      oracleWrite: 'NONE',
      sourceSchema: 'IAS20261',
      targetSchema: 'IAS20191',
      customer: {
        code: prepared.customer.externalCustomerCode,
        nameAr: prepared.customer.nameAr,
      },
      currencyCode: dto.currencyCode,
      orderDate: dto.orderDate,
      amount: prepared.amount.toString(),
      validationStatus: prepared.validationStatus,
      issueCodes: prepared.issueCodes,
      readyLines: prepared.readyLines,
      totalLines: prepared.lines.length,
      lines: prepared.lines.map((line) => ({
        ...line,
        packageSize: line.packageSize.toString(),
        quantity: line.quantity.toString(),
        sourcePrice: line.sourcePrice.toString(),
        originalAvailableQty: line.originalAvailableQty.toString(),
        totalAvailableQty: line.totalAvailableQty.toString(),
      })),
      oracleDraftPublication: {
        enabled: false,
        reason: 'مولدا SALES_ORDER.ORDER_SER وIAS_RESERVE_MST.DOC_SER لم يثبتا بعد',
      },
    };
  }

  async create(actor: AuthUser, dto: CreateSalesOrderDraftDto, req: Request) {
    const prepared = await this.prepare(actor, dto);
    const operationKey = String(req.header('Idempotency-Key') || '').trim();
    const serial = operationKey
      ? `MOB-${createHash('sha256').update(operationKey).digest('hex').slice(0, 26)}`
      : randomUUID();
    const existing = await (this.prisma as any).salesOrderDraft.findUnique({
      where: { organizationId_sourceSchema_sourceOrderSerial: {
        organizationId: actor.organizationId, sourceSchema: 'PLATFORM', sourceOrderSerial: serial,
      } },
      include: this.include,
    });
    if (existing) return existing;
    const created = await (this.prisma as any).salesOrderDraft.create({
      data: {
        organizationId: actor.organizationId, sourceSchema: 'PLATFORM', sourceOrderNo: `DRAFT-${serial.slice(0, 8)}`,
        sourceOrderSerial: serial, sourceOrderDate: new Date(`${dto.orderDate}T00:00:00Z`),
        sourceCustomerCode: prepared.customer.externalCustomerCode, sourceCustomerName: prepared.customer.nameAr,
        sourceCustomerMobile: prepared.customer.mobile || prepared.customer.phone, sourceCustomerAddress: prepared.customer.address,
        proposedCustomerCode: prepared.customer.externalCustomerCode, proposedCustomerName: prepared.customer.nameAr,
        currencyCode: dto.currencyCode, sourceAmount: prepared.amount, orderKind: prepared.orderKind,
        billDocumentType: prepared.orderKind === 'cash' ? '1' : '4',
        customerBindingStatus: prepared.orderKind === 'cash' && !prepared.customer.externalCustomerCode ? 'cash_name_only' : 'linked_by_code',
        validationStatus: prepared.validationStatus,
        validationSummary: {
          issueCodes: prepared.issueCodes, totalLines: prepared.lines.length, readyLines: prepared.readyLines,
          oracleWrite: 'NONE', platformTarget: '3004_TEST_ONLY', sourceSchema: 'IAS20261', oracleTarget: 'IAS20191_LOCKED',
        },
        notes: dto.notes?.trim() || null, oracleWriteEnabled: false, createdBy: actor.id, lines: { create: prepared.lines },
      }, include: this.include,
    });
    await this.audit.log({
      userId: actor.id, action: 'sales_order_draft_created', entityTable: 'sales_order_drafts', entityId: created.id,
      newValue: {
        customerCode: prepared.customer.externalCustomerCode, customerName: prepared.customer.nameAr,
        orderKind: prepared.orderKind, lineCount: prepared.lines.length,
        validationStatus: prepared.validationStatus, oracleWrite: 'NONE', sourceSchema: 'IAS20261',
      }, req,
    });
    return created;
  }
}
