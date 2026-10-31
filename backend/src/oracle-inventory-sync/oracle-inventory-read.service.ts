import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { smartSearchTerms } from '../common/smart-search';
import { RESERVATION_ITEM_BY_CODE, RESERVATION_ITEM_STANDARDS } from '../reservations/reservation-catalog';
import {
  ORACLE_INVENTORY_DECISION_TYPES,
  OracleInventoryItemsQueryDto,
  OracleInventorySourceQueryDto,
  OracleInventoryStockQueryDto,
  OracleInventoryWarehousesQueryDto,
} from './dto/oracle-inventory-query.dto';

type ItemActivityMovement = {
  movementDate: Date;
  inOut: number;
  primaryQuantity: Prisma.Decimal;
};

type ItemPricingMovement = ItemActivityMovement & {
  id: string;
  itemQuantity: Prisma.Decimal;
  unitName: string;
  packageSize?: Prisma.Decimal;
};

type ItemPricingSource = {
  itemCost: Prisma.Decimal | null;
  stockCost: Prisma.Decimal | null;
  currencyCode: string | null;
};

export function summarizeOracleMovementValuation(movements: Array<{
  itemQuantity: Prisma.Decimal;
  stockCost: Prisma.Decimal | null;
  inOut: number;
  externalWarehouseCode: string;
}>) {
  return movements.reduce((summary, row) => {
    if (!['101', '102', '103', '104'].includes(row.externalWarehouseCode)
      || Number(row.itemQuantity) === 0) return summary;
    if (row.stockCost == null || !Number.isFinite(Number(row.stockCost))) {
      summary.missingCostRows += 1;
      return summary;
    }
    const direction = row.inOut === 1 ? 1 : row.inOut === -1 ? -1 : 0;
    summary.totalInventoryCost += direction * Number(row.itemQuantity) * Number(row.stockCost);
    summary.valuedRows += 1;
    return summary;
  }, { totalInventoryCost: 0, valuedRows: 0, missingCostRows: 0 });
}

export function summarizeMovementPricing(
  movements: ItemPricingMovement[],
  sources: Map<string, ItemPricingSource>,
  baseUnit: { unitName: string; packageSize: number } = { unitName: 'الوحدة الأساسية', packageSize: 1 },
) {
  const normalizedPrice = (movement: ItemPricingMovement, price: Prisma.Decimal) => {
    const movementPackageSize = Number(movement.packageSize ?? 1);
    const value = Number(price);
    if (!Number.isFinite(movementPackageSize) || movementPackageSize <= 0 || !Number.isFinite(value)) return null;
    return Math.round(((value * baseUnit.packageSize / movementPackageSize) + Number.EPSILON) * 1e12) / 1e12;
  };
  const rowsForDirection = (direction: 1 | -1) => movements
    .filter((movement) => movement.inOut === direction)
    .map((movement) => ({ movement, source: sources.get(movement.id) }))
    .filter((entry) => entry.source?.itemCost != null && entry.source.currencyCode);
  const sales = rowsForDirection(-1);
  const supplies = rowsForDirection(1);
  const byCurrency = new Map<string, typeof sales>();
  for (const row of sales) {
    const currencyCode = row.source!.currencyCode!;
    const values = byCurrency.get(currencyCode) ?? [];
    values.push(row);
    byCurrency.set(currencyCode, values);
  }
  const lastSalePrices = [...byCurrency.entries()].map(([currencyCode, rows]) => ({
    currencyCode, price: String(normalizedPrice(rows[0].movement, rows[0].source!.itemCost!) ?? ''),
    movementDate: rows[0].movement.movementDate, unitName: baseUnit.unitName,
  })).filter((row) => row.price !== '');
  const averageSalePrices = [...byCurrency.entries()].flatMap(([currencyCode, rows]) => {
    const totals = rows.reduce((sum, row) => {
      const quantity = Math.abs(Number(row.movement.primaryQuantity)) / baseUnit.packageSize;
      const price = normalizedPrice(row.movement, row.source!.itemCost!);
      return Number.isFinite(quantity) && quantity > 0 && price !== null
        ? { value: sum.value + (price * quantity), quantity: sum.quantity + quantity }
        : sum;
    }, { value: 0, quantity: 0 });
    return totals.quantity > 0 ? [{
      currencyCode,
      price: String(Math.round((((totals.value / totals.quantity) + Number.EPSILON) * 1e12)) / 1e12),
      movementCount: rows.length,
      unitName: baseUnit.unitName,
    }] : [];
  });
  const lastSupplyByCurrency = new Map<string, typeof supplies[number]>();
  for (const row of supplies) {
    if (!lastSupplyByCurrency.has(row.source!.currencyCode!)) {
      lastSupplyByCurrency.set(row.source!.currencyCode!, row);
    }
  }
  const lastSupplyPrices = [...lastSupplyByCurrency.entries()].map(([currencyCode, row]) => ({
    currencyCode, price: String(normalizedPrice(row.movement, row.source!.itemCost!) ?? ''),
    movementDate: row.movement.movementDate, unitName: baseUnit.unitName,
  })).filter((row) => row.price !== '');
  return { lastSalePrices, averageSalePrices, lastSupplyPrices };
}

function inventoryDocumentTypeLabel(documentType: string, billDocumentType?: string | null) {
  if (documentType === '7') return 'صرف تحويل مخزني';
  if (documentType === '8') return 'استلام تحويل مخزني';
  if (documentType === '4') return billDocumentType === '1' ? 'فاتورة مبيعات نقدية' : 'فاتورة مبيعات آجلة';
  if (documentType === '5') return billDocumentType === '1' ? 'مردود مبيعات نقدي' : 'مردود مبيعات آجل';
  if (documentType === '6') return billDocumentType === '1' ? 'فاتورة مشتريات نقدية' : 'فاتورة مشتريات آجلة';
  return `مستند مخزني نوع ${documentType}`;
}

function summarizeItemActivity(movements: ItemActivityMovement[]) {
  const now = Date.now();
  const latestAt = movements[0]?.movementDate ?? null;
  const ageDays = latestAt ? Math.floor((now - latestAt.getTime()) / 86_400_000) : null;
  const inboundPrimaryQuantity = movements
    .filter((movement) => movement.inOut === 1)
    .reduce((total, movement) => total + Number(movement.primaryQuantity), 0);
  const outboundPrimaryQuantity = movements
    .filter((movement) => movement.inOut === -1)
    .reduce((total, movement) => total + Number(movement.primaryQuantity), 0);
  const status = ageDays === null || ageDays > 90 ? 'stagnant'
    : ageDays <= 30 && outboundPrimaryQuantity > 0 ? 'demanded' : 'moving';
  return {
    status,
    labelAr: status === 'demanded' ? 'مطلوب' : status === 'moving' ? 'متحرك' : 'راكد',
    inboundPrimaryQuantity,
    outboundPrimaryQuantity,
    lastMovementAt: latestAt,
    lastInboundAt: movements.find((movement) => movement.inOut === 1)?.movementDate ?? null,
    lastOutboundAt: movements.find((movement) => movement.inOut === -1)?.movementDate ?? null,
    basis: 'مرآة Oracle للقراءة فقط؛ مطلوب خلال 30 يومًا، متحرك خلال 90 يومًا، وإلا راكد',
  };
}

@Injectable()
export class OracleInventoryReadService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async recordBarcodePrint(
    actor: AuthUser,
    input: { itemCode?: string; copies?: number; channel?: string; sourceSchema?: string },
    req?: Request,
  ) {
    const itemCode = String(input.itemCode ?? '').trim();
    const copies = Math.trunc(Number(input.copies ?? 1));
    const channel = input.channel === 'zpl_download' ? 'zpl_download' : 'print_dialog';
    if (!itemCode) throw new BadRequestException('كود الصنف مطلوب');
    if (!Number.isFinite(copies) || copies < 1 || copies > 999) {
      throw new BadRequestException('عدد النسخ يجب أن يكون بين 1 و999');
    }
    const snapshot = await this.activeSnapshot(actor.organizationId, input.sourceSchema);
    const item = await this.prisma.oracleItemMirror.findFirst({
      where: {
        syncRunId: snapshot.activeRunId,
        organizationId: actor.organizationId,
        externalItemCode: itemCode,
        isInactive: false,
      },
      select: { externalItemCode: true, nameAr: true },
    });
    if (!item) throw new NotFoundException('الصنف غير موجود في لقطة المخزون المنشورة');
    const printedAt = new Date();
    await this.audit.log({
      userId: actor.id,
      action: 'inventory_barcode_printed',
      entityTable: 'oracle_inventory_items',
      entityId: item.externalItemCode,
      newValue: { copies, channel, itemName: item.nameAr, sourceSchema: snapshot.sourceSchema },
      reason: channel === 'zpl_download' ? 'تنزيل ملف ZPL' : 'فتح أمر طباعة الباركود',
      req,
    });
    return { recorded: true, itemCode: item.externalItemCode, itemName: item.nameAr, copies, channel, printedAt };
  }

  async barcodePrintReport(actor: AuthUser, sourceSchema?: string) {
    const snapshot = await this.activeSnapshot(actor.organizationId, sourceSchema);
    const [items, events] = await Promise.all([
      this.prisma.oracleItemMirror.findMany({
        where: { syncRunId: snapshot.activeRunId, organizationId: actor.organizationId, isInactive: false, isService: false },
        select: { externalItemCode: true, nameAr: true },
        orderBy: { nameAr: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: 'inventory_barcode_printed',
          entityTable: 'oracle_inventory_items',
          user: { organizationId: actor.organizationId },
        },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ]);
    const itemByCode = new Map(items.map((item) => [item.externalItemCode, item]));
    const byCode = new Map<string, { itemCode: string; itemName: string; totalCopies: number; printEvents: number; lastPrintedAt: Date; lastPrintedBy: string | null }>();
    for (const event of events) {
      const code = String(event.entityId ?? '');
      if (!itemByCode.has(code)) continue;
      const payload = (event.newValue ?? {}) as Record<string, unknown>;
      const eventCopies = Math.max(1, Number(payload.copies ?? 1) || 1);
      const current = byCode.get(code);
      if (current) {
        current.totalCopies += eventCopies;
        current.printEvents += 1;
      } else {
        byCode.set(code, {
          itemCode: code,
          itemName: itemByCode.get(code)!.nameAr,
          totalCopies: eventCopies,
          printEvents: 1,
          lastPrintedAt: event.createdAt,
          lastPrintedBy: event.user?.fullName ?? null,
        });
      }
    }
    const printed = [...byCode.values()].sort((a, b) => b.lastPrintedAt.getTime() - a.lastPrintedAt.getTime());
    const unprinted = items.filter((item) => !byCode.has(item.externalItemCode));
    return {
      summary: {
        totalItems: items.length,
        printedItems: printed.length,
        unprintedItems: unprinted.length,
        totalCopies: printed.reduce((sum, item) => sum + item.totalCopies, 0),
      },
      printed,
      unprinted,
    };
  }

  private async activeSnapshot(organizationId: string, sourceSchema?: string) {
    const snapshots = await this.prisma.oracleInventoryActiveSnapshot.findMany({
      where: {
        organizationId,
        ...(sourceSchema ? { sourceSchema: sourceSchema.trim().toUpperCase() } : {}),
      },
      orderBy: { activatedAt: 'desc' },
      take: 2,
      include: {
        activeRun: {
          select: {
            id: true,
            sourceSchema: true,
            status: true,
            extractedAt: true,
            validatedAt: true,
            publishedAt: true,
            sourceCounts: true,
            validationSummary: true,
          },
        },
      },
    });
    if (snapshots.length === 0) {
      throw new NotFoundException('No published Oracle inventory snapshot is available.');
    }
    if (!sourceSchema && snapshots.length > 1) {
      throw new BadRequestException('sourceSchema is required when more than one Oracle source is active.');
    }
    const snapshot = snapshots[0];
    if (snapshot.activeRun.status !== 'published') {
      throw new NotFoundException('The active Oracle inventory snapshot is not published.');
    }
    return snapshot;
  }

  async summary(actor: AuthUser, query: OracleInventorySourceQueryDto) {
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
    const runId = snapshot.activeRunId;
    const movementRun = await this.prisma.oracleMovementSyncRun.findFirst({
      where: { organizationId: actor.organizationId, sourceSchema: snapshot.sourceSchema, status: 'published' },
      orderBy: [{ extractedAt: 'desc' }, { startedAt: 'desc' }],
      select: { id: true, status: true, extractedAt: true },
    });
    const [itemGroups, items, itemUnits, warehouseGroups, warehouses, stockBalances, branchMappings, valuationRows, decisionRows, movementCoverage, approvedStockRows, reservationTons] = await Promise.all([
      this.prisma.oracleItemGroupMirror.count({ where: { syncRunId: runId, organizationId: actor.organizationId } }),
      this.prisma.oracleItemMirror.count({ where: { syncRunId: runId, organizationId: actor.organizationId } }),
      this.prisma.oracleItemUnitMirror.count({ where: { syncRunId: runId, organizationId: actor.organizationId } }),
      this.prisma.oracleWarehouseGroupMirror.count({ where: { syncRunId: runId, organizationId: actor.organizationId } }),
      this.prisma.oracleWarehouseMirror.count({ where: { syncRunId: runId, organizationId: actor.organizationId } }),
      this.prisma.oracleStockBalanceMirror.count({ where: { syncRunId: runId, organizationId: actor.organizationId } }),
      this.prisma.oracleBranchMapping.findMany({
        where: {
          organizationId: actor.organizationId,
          sourceSchema: snapshot.sourceSchema,
          isActive: true,
        },
        select: {
          externalBranchCode: true,
          verifiedAt: true,
          platformBranch: { select: { id: true, name: true, active: true } },
        },
        orderBy: { externalBranchCode: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{
        total_value: Prisma.Decimal | null;
        primary_quantity: Prisma.Decimal | null;
        valued_rows: bigint;
        missing_cost_rows: bigint;
      }>>(Prisma.sql`
        WITH ranked AS (
          SELECT s.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY s.external_item_code, s.external_warehouse_code
                   ORDER BY u.is_stock_unit DESC, u.is_main_unit DESC, s.package_size ASC
                 ) AS rn
          FROM oracle_stock_balances_mirror s
          JOIN oracle_item_units_mirror u
            ON u.sync_run_id = s.sync_run_id
           AND u.external_item_code = s.external_item_code
           AND u.unit_name = s.unit_name
          WHERE s.sync_run_id = ${runId}::uuid
            AND s.organization_id = ${actor.organizationId}::uuid
            AND s.is_inactive = false
            AND u.is_inactive = false
            AND EXISTS (
              SELECT 1 FROM oracle_items_mirror i
              WHERE i.sync_run_id = s.sync_run_id
                AND i.external_item_code = s.external_item_code
                AND i.is_inactive = false AND i.is_service = false
            )
        ), movement_value AS (
          SELECT
            COALESCE(SUM(CASE
              WHEN in_out = 1 THEN item_quantity * COALESCE(stock_cost, 0)
              WHEN in_out = -1 THEN -item_quantity * COALESCE(stock_cost, 0)
              ELSE 0 END), 0) AS total_value,
            COUNT(*) FILTER (WHERE stock_cost IS NOT NULL AND item_quantity <> 0) AS valued_rows,
            COUNT(*) FILTER (WHERE stock_cost IS NULL AND item_quantity <> 0) AS missing_cost_rows
          FROM oracle_inventory_movements_mirror
          WHERE sync_run_id = ${movementRun?.id ?? null}::uuid
            AND organization_id = ${actor.organizationId}::uuid
            AND external_warehouse_code IN ('101','102','103','104')
        )
        SELECT mv.total_value,
          COALESCE((SELECT SUM(available_quantity * package_size) FROM ranked
            WHERE rn = 1 AND external_warehouse_code IN ('101','102','103','104')), 0) AS primary_quantity,
          mv.valued_rows, mv.missing_cost_rows
        FROM movement_value mv
      `),
      this.prisma.$queryRaw<Array<{
        item_code: string;
        item_name: string;
        source_updated_at: Date | null;
        has_stock_balance: boolean;
        current_quantity: Prisma.Decimal;
        stock_value: Prisma.Decimal;
        outbound_30: Prisma.Decimal;
        outbound_90: Prisma.Decimal;
        outbound_180: Prisma.Decimal;
        outbound_365: Prisma.Decimal;
        inbound_90: Prisma.Decimal;
        last_movement_at: Date | null;
        last_outbound_at: Date | null;
        first_movement_at: Date | null;
        movement_count: bigint;
        active_months: bigint;
        peak_month_outbound: Prisma.Decimal;
      }>>(Prisma.sql`
        WITH ranked AS (
          SELECT s.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY s.external_item_code, s.external_warehouse_code
                   ORDER BY u.is_stock_unit DESC, u.is_main_unit DESC, s.package_size ASC
                 ) AS rn
          FROM oracle_stock_balances_mirror s
          JOIN oracle_item_units_mirror u
            ON u.sync_run_id = s.sync_run_id
           AND u.external_item_code = s.external_item_code
           AND u.unit_name = s.unit_name
          WHERE s.sync_run_id = ${runId}::uuid
            AND s.organization_id = ${actor.organizationId}::uuid
            AND s.is_inactive = false
        ), stock AS (
          SELECT external_item_code,
                 SUM(available_quantity * package_size) AS current_quantity,
                 SUM(available_quantity * package_size * COALESCE(weighted_average_cost, primary_cost, 0)) AS stock_value
          FROM ranked WHERE rn = 1 GROUP BY external_item_code
        ), movement_base AS (
          SELECT external_item_code, movement_date, in_out,
                 primary_quantity + primary_free_quantity AS quantity
          FROM oracle_inventory_movements_mirror
          WHERE sync_run_id = ${movementRun?.id ?? null}::uuid
            AND organization_id = ${actor.organizationId}::uuid
        ), monthly AS (
          SELECT external_item_code, DATE_TRUNC('month', movement_date) AS month,
                 SUM(CASE WHEN in_out = -1 THEN quantity ELSE 0 END) AS outbound
          FROM movement_base
          GROUP BY external_item_code, DATE_TRUNC('month', movement_date)
        ), monthly_stats AS (
          SELECT external_item_code,
                 COUNT(*) FILTER (WHERE outbound > 0) AS active_months,
                 COALESCE(MAX(outbound), 0) AS peak_month_outbound
          FROM monthly GROUP BY external_item_code
        ), movement AS (
          SELECT external_item_code,
                 SUM(CASE WHEN in_out = -1 AND movement_date >= CURRENT_DATE - INTERVAL '30 days'
                          THEN quantity ELSE 0 END) AS outbound_30,
                 SUM(CASE WHEN in_out = -1 AND movement_date >= CURRENT_DATE - INTERVAL '90 days'
                          THEN quantity ELSE 0 END) AS outbound_90,
                 SUM(CASE WHEN in_out = -1 AND movement_date >= CURRENT_DATE - INTERVAL '180 days'
                          THEN quantity ELSE 0 END) AS outbound_180,
                 SUM(CASE WHEN in_out = -1 AND movement_date >= CURRENT_DATE - INTERVAL '365 days'
                          THEN quantity ELSE 0 END) AS outbound_365,
                 SUM(CASE WHEN in_out = 1 AND movement_date >= CURRENT_DATE - INTERVAL '90 days'
                          THEN quantity ELSE 0 END) AS inbound_90,
                 MAX(movement_date) AS last_movement_at,
                 MAX(movement_date) FILTER (WHERE in_out = -1 AND quantity > 0) AS last_outbound_at,
                 MIN(movement_date) AS first_movement_at,
                 COUNT(*) AS movement_count
          FROM movement_base
          GROUP BY external_item_code
        )
        SELECT i.external_item_code AS item_code,
               i.name_ar AS item_name,
               i.source_updated_at,
               (st.external_item_code IS NOT NULL) AS has_stock_balance,
               COALESCE(st.current_quantity, 0) AS current_quantity,
               COALESCE(st.stock_value, 0) AS stock_value,
               COALESCE(m.outbound_30, 0) AS outbound_30,
               COALESCE(m.outbound_90, 0) AS outbound_90,
               COALESCE(m.outbound_180, 0) AS outbound_180,
               COALESCE(m.outbound_365, 0) AS outbound_365,
               COALESCE(m.inbound_90, 0) AS inbound_90,
               m.last_movement_at,
               m.last_outbound_at,
               m.first_movement_at,
               COALESCE(m.movement_count, 0) AS movement_count,
               COALESCE(ms.active_months, 0) AS active_months,
               COALESCE(ms.peak_month_outbound, 0) AS peak_month_outbound
        FROM oracle_items_mirror i
        LEFT JOIN stock st ON st.external_item_code = i.external_item_code
        LEFT JOIN movement m ON m.external_item_code = i.external_item_code
        LEFT JOIN monthly_stats ms ON ms.external_item_code = i.external_item_code
        WHERE i.sync_run_id = ${runId}::uuid
          AND i.organization_id = ${actor.organizationId}::uuid
          AND i.is_inactive = false
          AND i.is_service = false
      `),
      movementRun ? this.prisma.oracleInventoryMovementMirror.aggregate({
        where: { syncRunId: movementRun.id, organizationId: actor.organizationId },
        _count: { _all: true },
        _min: { movementDate: true },
        _max: { movementDate: true },
      }) : Promise.resolve({ _count: { _all: 0 }, _min: { movementDate: null }, _max: { movementDate: null } }),
      this.prisma.$queryRaw<Array<{
        external_item_code: string;
        primary_quantity: Prisma.Decimal;
      }>>(Prisma.sql`
        WITH ranked AS (
          SELECT s.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY s.external_item_code, s.external_warehouse_code
                   ORDER BY u.is_stock_unit DESC, u.is_main_unit DESC, s.package_size ASC
                 ) AS rn
          FROM oracle_stock_balances_mirror s
          JOIN oracle_item_units_mirror u
            ON u.sync_run_id = s.sync_run_id
           AND u.external_item_code = s.external_item_code
           AND u.unit_name = s.unit_name
          WHERE s.sync_run_id = ${runId}::uuid
            AND s.organization_id = ${actor.organizationId}::uuid
            AND s.is_inactive = false
            AND s.external_item_code IN (${Prisma.join(RESERVATION_ITEM_STANDARDS.map((item) => item.itemCode))})
        )
        SELECT external_item_code,
               COALESCE(SUM(available_quantity * package_size), 0) AS primary_quantity
        FROM ranked
        WHERE rn = 1
        GROUP BY external_item_code
      `),
      this.prisma.reservation.aggregate({
        where: {
          customer: { organizationId: actor.organizationId },
          status: { in: ['open', 'partial'] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        _sum: { remainingTons: true },
      }),
    ]);

    const valuation = valuationRows[0];
    const movementFrom = movementCoverage._min.movementDate;
    const movementTo = movementCoverage._max.movementDate;
    const coverageDays = movementFrom && movementTo
      ? Math.max(1, Math.round((movementTo.getTime() - movementFrom.getTime()) / 86_400_000) + 1)
      : 0;
    const now = Date.now();
    const assessments = decisionRows.map((row) => {
      const quantity = Number(row.current_quantity);
      const outbound30 = Number(row.outbound_30);
      const outbound90 = Number(row.outbound_90);
      const outbound180 = Number(row.outbound_180);
      const outbound365 = Number(row.outbound_365);
      const inbound90 = Number(row.inbound_90);
      const demandWindowDays = Math.max(30, Math.min(90, coverageDays || 90));
      const dailyDemand = outbound90 > 0 ? outbound90 / demandWindowDays : 0;
      const daysOfCover = dailyDemand > 0 ? Math.max(0, quantity) / dailyDemand : null;
      const activeMonths = Number(row.active_months);
      const peakShare = outbound365 > 0 ? Number(row.peak_month_outbound) / outbound365 : 0;
      const lastOutboundAgeDays = row.last_outbound_at
        ? Math.floor((now - row.last_outbound_at.getTime()) / 86_400_000)
        : null;
      const isNewItem = !!row.source_updated_at && now - row.source_updated_at.getTime() < 90 * 86_400_000;
      let type = 'normal';
      let severity: 'critical' | 'high' | 'medium' | 'low' = 'low';
      let risk = 'لا توجد مخاطرة عاجلة وفق البيانات المتاحة.';
      let recommendation = 'مراقبة الرصيد والحركة ضمن دورة المراجعة المعتادة.';
      let confidence: 'high' | 'medium' | 'preliminary' = coverageDays >= 180 ? 'high' : 'preliminary';

      if (quantity < 0) {
        type = 'negative_stock'; severity = 'critical';
        risk = 'الرصيد سالب وقد يدل على صرف غير مرحّل أو اختلاف وحدة أو توقيت توريد.';
        recommendation = 'إيقاف القرار الآلي لهذا الصنف والتحقق من التحويلات والوحدات والتوريدات المتأخرة.';
      } else if (quantity <= 0 && outbound90 > 0) {
        type = 'stockout_risk'; severity = 'critical';
        // Complete INVI008 snapshots omit zero balances. Keep missing balances
        // visible without presenting an inferred zero as a confirmed live stockout.
        risk = row.has_stock_balance
          ? 'الرصيد صفر في اللقطة المنشورة مع وجود صرف حديث؛ توجد مخاطرة نفاد.'
          : 'لا يظهر رصيد في اللقطة المنشورة مع وجود صرف حديث؛ توجد مخاطرة نفاد تستلزم التحقق من الرصيد.';
        recommendation = 'تأكيد الرصيد الحالي ومراجعة أوامر الشراء المفتوحة قبل اعتماد كمية تغطي 60 يومًا.';
        if (!row.has_stock_balance) confidence = 'preliminary';
      } else if (quantity > 0 && dailyDemand > 0 && daysOfCover !== null && daysOfCover < 21) {
        type = 'reorder'; severity = 'high';
        risk = `الرصيد يغطي نحو ${Math.round(daysOfCover)} يومًا فقط.`;
        recommendation = 'إعادة الطلب للوصول إلى تغطية 60 يومًا، مع مراجعة مدة التوريد الفعلية.';
      } else if (quantity > 0 && coverageDays >= 180 && !isNewItem && (lastOutboundAgeDays === null || lastOutboundAgeDays >= 180)) {
        type = 'dead_stock'; severity = Number(row.stock_value) > 0 ? 'high' : 'medium';
        risk = 'مخزون راكد بلا صرف خلال 180 يومًا على الأقل ويجمّد رأس المال.';
        recommendation = 'إيقاف الشراء، ثم دراسة التحويل بين الفروع أو العرض الترويجي أو الإرجاع للمورد.';
        confidence = lastOutboundAgeDays === null ? 'medium' : 'high';
      } else if (quantity > 0 && coverageDays >= 180 && activeMonths >= 2 && activeMonths <= 5 && peakShare >= 0.4) {
        type = 'seasonal_candidate'; severity = 'medium';
        risk = 'الحركة مركزة في أشهر محدودة؛ الصنف مرشح لأن يكون موسميًا.';
        recommendation = 'عدم الاعتماد على المتوسط العام؛ بناء خطة شراء حسب أشهر الذروة بعد اكتمال 12 شهرًا من البيانات.';
        confidence = coverageDays >= 365 ? 'high' : 'preliminary';
      } else if (quantity > 0 && dailyDemand > 0 && daysOfCover !== null && daysOfCover > 365) {
        type = 'slow_moving'; severity = 'medium';
        risk = 'معدل الصرف بطيء والرصيد يتجاوز استهلاك سنة تقريبًا.';
        recommendation = 'خفض حد إعادة الطلب ودراسة نقل جزء من الكمية أو تنشيط المبيعات.';
      } else if (quantity > 0 && dailyDemand > 0 && daysOfCover !== null && daysOfCover > 180) {
        type = 'overstock'; severity = 'medium';
        risk = 'المخزون أعلى من الطلب المتوقع لأكثر من ستة أشهر.';
        recommendation = 'تجميد الشراء مؤقتًا وموازنة الكميات بين المستودعات.';
      } else if (quantity > 0 && dailyDemand > 0 && daysOfCover !== null && daysOfCover <= 45) {
        type = 'fast_moving'; severity = 'low';
        risk = 'صنف سريع الحركة يحتاج متابعة مستمرة لتجنب النفاد.';
        recommendation = 'مراجعة الرصيد أسبوعيًا والحفاظ على مخزون أمان 30 يومًا.';
      } else if (quantity <= 0) {
        type = 'no_stock_no_demand';
        risk = 'لا يوجد رصيد ولا طلب حديث؛ لا توجد توصية شراء حاليًا.';
        recommendation = 'لا يتم التوريد إلا عند ظهور طلب أو حجز فعلي.';
      } else if (Number(row.movement_count) === 0 && coverageDays < 180) {
        type = 'insufficient_history';
        risk = 'لا يوجد تاريخ حركة كافٍ للحكم على الركود أو الموسمية.';
        recommendation = 'الانتظار حتى اكتمال فترة تحليل كافية أو تحميل تاريخ أقدم.';
        confidence = 'preliminary';
      }

      const recommendedSupplyQuantity = ['stockout_risk', 'reorder'].includes(type)
        ? Math.max(0, Math.ceil(dailyDemand * 60 - Math.max(0, quantity)))
        : 0;
      return {
        type,
        severity,
        confidence,
        itemCode: row.item_code,
        itemName: row.item_name,
        hasStockBalance: row.has_stock_balance,
        currentQuantity: quantity,
        stockValue: Number(row.stock_value),
        outbound30,
        outbound90,
        outbound180,
        outbound365,
        inbound90,
        daysOfCover: daysOfCover === null ? null : Math.round(daysOfCover * 10) / 10,
        lastMovementAt: row.last_movement_at,
        lastOutboundAt: row.last_outbound_at,
        activeMonths,
        peakMonthShare: Math.round(peakShare * 1000) / 10,
        recommendedSupplyQuantity,
        risk,
        recommendation,
      };
    });
    const emptyClassifications = Object.fromEntries(ORACLE_INVENTORY_DECISION_TYPES.map((type) => [
      type, { type, count: 0, stockValue: 0, recommendedSupplyQuantity: 0 },
    ]));
    const classificationSummary = Object.values(assessments.reduce<Record<string, {
      type: string; count: number; stockValue: number; recommendedSupplyQuantity: number;
    }>>((summary, item) => {
      const bucket = (summary[item.type] ??= { type: item.type, count: 0, stockValue: 0, recommendedSupplyQuantity: 0 });
      bucket.count += 1;
      bucket.stockValue += item.stockValue;
      bucket.recommendedSupplyQuantity += item.recommendedSupplyQuantity;
      return summary;
    }, emptyClassifications)).sort((a, b) => b.count - a.count);
    const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
    const decisionPage = query.decisionPage ?? 1;
    const decisionLimit = query.decisionLimit ?? 60;
    const matchingDecisions = assessments
      .filter((item) => !['normal', 'no_stock_no_demand'].includes(item.type))
      .filter((item) => !query.decisionType || item.type === query.decisionType)
      .sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity]
        || b.recommendedSupplyQuantity - a.recommendedSupplyQuantity
        || Math.abs(b.stockValue) - Math.abs(a.stockValue));
    const decisionTotal = matchingDecisions.length;
    const decisions = matchingDecisions.slice(
      (decisionPage - 1) * decisionLimit,
      decisionPage * decisionLimit,
    );
    const approvedItems = approvedStockRows.map((row) => {
      const standard = RESERVATION_ITEM_BY_CODE.get(row.external_item_code)!;
      const rods = Number(row.primary_quantity);
      return {
        itemCode: standard.itemCode,
        itemName: standard.nameAr,
        rodsPerTon: standard.rodsPerTon,
        stockRods: rods,
        stockTons: rods / standard.rodsPerTon,
      };
    });
    const grossTons = approvedItems.reduce((sum, item) => sum + item.stockTons, 0);
    const reservedTons = Number(reservationTons._sum.remainingTons ?? 0);

    return {
      snapshot: {
        runId,
        sourceSchema: snapshot.sourceSchema,
        activatedAt: snapshot.activatedAt,
        extractedAt: snapshot.activeRun.extractedAt,
        validatedAt: snapshot.activeRun.validatedAt,
        publishedAt: snapshot.activeRun.publishedAt,
      },
      counts: { itemGroups, items, itemUnits, warehouseGroups, warehouses, stockBalances },
      valuation: {
        totalInventoryCost: Number(valuation?.total_value ?? 0),
        totalPrimaryQuantity: Number(valuation?.primary_quantity ?? 0),
        valuedRows: Number(valuation?.valued_rows ?? 0),
        missingCostRows: Number(valuation?.missing_cost_rows ?? 0),
        currencyCode: 'SAR',
        warehouseCodes: ['101', '102', '103', '104'],
        basis: 'مجموع حركات Oracle: الكمية × تكلفة المخزون مع اتجاه الوارد/المنصرف',
      },
      reservationStock: {
        grossTons,
        reservedTons,
        netAvailableTons: grossTons - reservedTons,
        basis: 'رصيد الأصناف العشرة المعتمدة بالسيخ ÷ معيار عدد الأسياخ في الطن، ثم طرح الحجوزات النشطة.',
        approvedItems,
      },
      movementAnalysis: {
        source: 'oracle_read_only_mirror',
        runId: movementRun?.id ?? null,
        runStatus: movementRun?.status ?? null,
        extractedAt: movementRun?.extractedAt ?? null,
        movementCount: movementCoverage._count._all,
        fromDate: movementFrom,
        toDate: movementTo,
        coverageDays,
        seasonalAssessment: coverageDays >= 365 ? 'reliable' : coverageDays >= 180 ? 'preliminary' : 'insufficient',
        note: coverageDays >= 365
          ? 'التصنيف الموسمي يعتمد على سنة حركة كاملة أو أكثر.'
          : 'التصنيف الموسمي أولي حتى اكتمال 12 شهرًا من حركة الأصناف.',
      },
      classificationSummary,
      decisions,
      decisionPagination: {
        page: decisionPage,
        limit: decisionLimit,
        total: decisionTotal,
        totalPages: Math.max(1, Math.ceil(decisionTotal / decisionLimit)),
      },
      branchMappings,
    };
  }

  async itemGroups(actor: AuthUser, query: OracleInventorySourceQueryDto) {
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
    return this.prisma.oracleItemGroupMirror.findMany({
      where: { syncRunId: snapshot.activeRunId, organizationId: actor.organizationId },
      select: {
        externalGroupCode: true,
        nameAr: true,
        nameEn: true,
        parentExternalCode: true,
        sourceUpdatedAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { externalGroupCode: 'asc' },
    });
  }

  async items(actor: AuthUser, query: OracleInventoryItemsQueryDto) {
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();
    const searchTerms = smartSearchTerms(search);
    const where: Prisma.OracleItemMirrorWhereInput = {
      syncRunId: snapshot.activeRunId,
      organizationId: actor.organizationId,
      ...(query.groupCode ? { externalGroupCode: query.groupCode.trim() } : {}),
      ...(query.status === 'inactive' ? { isInactive: true } : query.status === 'all' ? {} : { isInactive: false }),
      ...(searchTerms.length ? {
        AND: searchTerms.map((term) => ({ OR: [
          { externalItemCode: { contains: term, mode: 'insensitive' as const } },
          { nameAr: { contains: term, mode: 'insensitive' as const } },
          { units: { some: { barcode: { contains: term, mode: 'insensitive' as const } } } },
        ] })),
      } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.oracleItemMirror.count({ where }),
      this.prisma.oracleItemMirror.findMany({
        where,
        select: {
          externalItemCode: true,
          nameAr: true,
          externalGroupCode: true,
          referencePrimaryCost: true,
          referenceWeightedAverageCost: true,
          isInactive: true,
          isService: true,
          sourceUpdatedAt: true,
          group: { select: { nameAr: true, nameEn: true } },
          units: {
            select: {
              packageSize: true,
              stockRows: { select: { availableQuantity: true, isInactive: true } },
            },
          },
          _count: { select: { units: true } },
        },
        orderBy: { externalItemCode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      snapshotRunId: snapshot.activeRunId,
      items: rows.map((row) => ({
        ...row,
        units: undefined,
        totalAvailablePrimaryQuantity: row.units.reduce((total, unit) =>
          total + unit.stockRows
            .filter((stock) => !stock.isInactive)
            .reduce((sum, stock) => sum + Number(stock.availableQuantity) * Number(unit.packageSize), 0), 0).toString(),
        referencePrimaryCost: row.referencePrimaryCost?.toString() ?? null,
        referenceWeightedAverageCost: row.referenceWeightedAverageCost?.toString() ?? null,
      })),
    };
  }

  async itemLabels(actor: AuthUser, externalItemCodes: string[], query: OracleInventorySourceQueryDto = {}) {
    const codes = [...new Set(externalItemCodes.map((code) => code.trim()).filter(Boolean))];
    if (codes.length === 0) return [];
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
    return this.prisma.oracleItemMirror.findMany({
      where: {
        syncRunId: snapshot.activeRunId,
        organizationId: actor.organizationId,
        externalItemCode: { in: codes },
      },
      select: { externalItemCode: true, nameAr: true },
    });
  }

  async item(actor: AuthUser, externalItemCode: string, query: OracleInventorySourceQueryDto) {
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
    const movementRun = await this.prisma.oracleMovementSyncRun.findFirst({
      where: {
        organizationId: actor.organizationId,
        sourceSchema: snapshot.sourceSchema,
        status: 'published',
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    const [item, movements] = await Promise.all([this.prisma.oracleItemMirror.findFirst({
      where: {
        syncRunId: snapshot.activeRunId,
        organizationId: actor.organizationId,
        externalItemCode,
      },
      select: {
        externalItemCode: true,
        nameAr: true,
        externalGroupCode: true,
        referencePrimaryCost: true,
        referenceWeightedAverageCost: true,
        isInactive: true,
        isService: true,
        sourceUpdatedAt: true,
        group: { select: { nameAr: true, nameEn: true } },
        units: {
          select: {
            unitName: true,
            packageSize: true,
            isMainUnit: true,
            isSaleUnit: true,
            isPurchaseUnit: true,
            isStockUnit: true,
            isPriceUnit: true,
            noSale: true,
            barcode: true,
            unitLevel: true,
            usesSerialNumber: true,
            isInactive: true,
            inactiveReason: true,
            salePrice: true,
            stockRows: {
              select: {
                unitName: true,
                packageSize: true,
                externalWarehouseCode: true,
                availableQuantity: true,
                primaryCost: true,
                weightedAverageCost: true,
                isInactive: true,
                warehouse: { select: { nameAr: true, externalBranchCode: true } },
              },
              orderBy: [{ externalWarehouseCode: 'asc' }],
            },
          },
          orderBy: [{ packageSize: 'asc' }, { unitName: 'asc' }],
        },
      },
    }), this.prisma.oracleInventoryMovementMirror.findMany({
      where: {
        organizationId: actor.organizationId,
        syncRunId: movementRun?.id ?? '00000000-0000-0000-0000-000000000000',
        externalItemCode,
      },
      select: {
        id: true,
        sourceFingerprint: true,
        movementDate: true,
        documentType: true,
        billDocumentType: true,
        documentNumber: true,
        documentSequence: true,
        unitName: true,
        packageSize: true,
        itemQuantity: true,
        freeQuantity: true,
        primaryQuantity: true,
        primaryFreeQuantity: true,
        inOut: true,
        externalWarehouseCode: true,
        description: true,
        referenceNumber: true,
        itemCost: true,
        stockCost: true,
        currencyCode: true,
        externalCustomerCode: true,
        loadedAt: true,
      },
      orderBy: [{ movementDate: 'desc' }, { documentSequence: 'desc' }],
      take: 100,
    })]);
    if (!item) throw new NotFoundException('Oracle inventory item was not found in the active snapshot.');
    const customerCodeByMovement = new Map<string, string>();
    const sourceValuesByMovement = new Map<string, {
      itemCost: Prisma.Decimal | null;
      stockCost: Prisma.Decimal | null;
      currencyCode: string | null;
    }>();
    for (const movement of movements) {
      if (movement.externalCustomerCode) customerCodeByMovement.set(movement.id, movement.externalCustomerCode);
      sourceValuesByMovement.set(movement.id, {
        itemCost: movement.itemCost,
        stockCost: movement.stockCost,
        currencyCode: movement.currencyCode,
      });
    }
    const customerCodes = [...new Set(customerCodeByMovement.values())];
    const customers = customerCodes.length ? await this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId, externalCustomerCode: { in: customerCodes } },
      select: { id: true, name: true, externalCustomerCode: true },
    }) : [];
    const customerByCode = new Map(customers.map((customer) => [customer.externalCustomerCode, customer]));
    const baseUnit = item.units.find((unit) => unit.isMainUnit)
      ?? item.units.find((unit) => unit.isStockUnit)
      ?? item.units.find((unit) => Number(unit.packageSize) === 1)
      ?? item.units[0];
    const normalizedPricing = summarizeMovementPricing(movements, sourceValuesByMovement, {
      unitName: baseUnit?.unitName ?? 'الوحدة الأساسية',
      packageSize: Number(baseUnit?.packageSize ?? 1),
    });
    const priceSourceUnit = baseUnit?.salePrice != null
      ? baseUnit
      : item.units.find((unit) => unit.salePrice != null);
    const normalizedSalePrice = priceSourceUnit?.salePrice == null || !baseUnit
      ? null
      : Number(priceSourceUnit.salePrice) * Number(baseUnit.packageSize) / Number(priceSourceUnit.packageSize);
    return {
      ...item,
      snapshotRunId: snapshot.activeRunId,
      referencePrimaryCost: item.referencePrimaryCost?.toString() ?? null,
      referenceWeightedAverageCost: item.referenceWeightedAverageCost?.toString() ?? null,
      units: item.units.map(({ stockRows: _stockRows, ...unit }) => ({
        ...unit,
        packageSize: unit.packageSize.toString(),
        salePrice: unit.salePrice?.toString() ?? null,
      })),
      stockRows: item.units.flatMap((unit) => unit.stockRows.map((stock) => ({
          ...stock,
          packageSize: stock.packageSize.toString(),
          availableQuantity: stock.availableQuantity.toString(),
          primaryCost: stock.primaryCost?.toString() ?? null,
          weightedAverageCost: stock.weightedAverageCost?.toString() ?? null,
        }))),
      movements: movements.map((movement) => ({
        ...movement,
        documentTypeLabelAr: inventoryDocumentTypeLabel(movement.documentType, movement.billDocumentType),
        publishedAt: movement.loadedAt,
        customer: customerByCode.get(customerCodeByMovement.get(movement.id) ?? '') ?? null,
        itemCost: sourceValuesByMovement.get(movement.id)?.itemCost?.toString() ?? null,
        stockCost: sourceValuesByMovement.get(movement.id)?.stockCost?.toString() ?? null,
        currencyCode: sourceValuesByMovement.get(movement.id)?.currencyCode ?? null,
        packageSize: movement.packageSize.toString(),
        itemQuantity: movement.itemQuantity.toString(),
        freeQuantity: movement.freeQuantity.toString(),
        primaryQuantity: movement.primaryQuantity.toString(),
        primaryFreeQuantity: movement.primaryFreeQuantity.toString(),
      })),
      activity: summarizeItemActivity(movements),
      pricing: {
        baseUnitName: baseUnit?.unitName ?? null,
        lastSupplyCost: normalizedPricing.lastSupplyPrices.length === 1 ? normalizedPricing.lastSupplyPrices[0].price : null,
        lastSupplyPrices: normalizedPricing.lastSupplyPrices,
        weightedAverageCost: item.referenceWeightedAverageCost?.toString() ?? null,
        salePrice: normalizedSalePrice == null ? null : String(Math.round((normalizedSalePrice + Number.EPSILON) * 1e12) / 1e12),
        salePriceUnit: baseUnit?.unitName ?? null,
        averageSalePrice: normalizedPricing.averageSalePrices.length === 1 ? normalizedPricing.averageSalePrices[0].price : null,
        lastSalePrice: normalizedPricing.lastSalePrices.length === 1 ? normalizedPricing.lastSalePrices[0].price : null,
        lastSalePrices: normalizedPricing.lastSalePrices,
        averageSalePrices: normalizedPricing.averageSalePrices,
        noteAr: normalizedSalePrice == null
          ? 'سعر البيع الافتراضي غير موجود في اللقطة الحالية. أعد نشر لقطة INVI008 المحدثة.'
          : `الأسعار معروضة تلقائيًا حسب الوحدة الأساسية (${baseUnit?.unitName ?? 'غير محددة'}). آخر ومتوسط البيع محسوبان من أحدث 100 حركة Oracle لكل عملة دون خلط العملات.`,
      },
    };
  }

  async warehouses(actor: AuthUser, query: OracleInventoryWarehousesQueryDto) {
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
    const where: Prisma.OracleWarehouseMirrorWhereInput = {
      syncRunId: snapshot.activeRunId,
      organizationId: actor.organizationId,
      ...(query.status === 'inactive' ? { isInactive: true } : query.status === 'all' ? {} : { isInactive: false }),
    };
    const [warehouses, mappings] = await Promise.all([
      this.prisma.oracleWarehouseMirror.findMany({
        where,
        select: {
          externalWarehouseCode: true,
          nameAr: true,
          nameEn: true,
          locationText: true,
          phone: true,
          isInactive: true,
          keeperName: true,
          externalGroupCode: true,
          warehouseType: true,
          noSale: true,
          checkAvailableQuantity: true,
          externalBranchCode: true,
          warehouseGroup: { select: { nameAr: true, nameEn: true } },
          _count: { select: { stockRows: true } },
        },
        orderBy: { externalWarehouseCode: 'asc' },
      }),
      this.prisma.oracleBranchMapping.findMany({
        where: { organizationId: actor.organizationId, sourceSchema: snapshot.sourceSchema, isActive: true },
        select: {
          externalBranchCode: true,
          verifiedAt: true,
          platformBranch: { select: { id: true, name: true, active: true } },
        },
      }),
    ]);
    const mappingByCode = new Map(mappings.map((mapping) => [mapping.externalBranchCode, mapping]));
    return {
      snapshotRunId: snapshot.activeRunId,
      items: warehouses.map((warehouse) => ({
        ...warehouse,
        branchMapping: warehouse.externalBranchCode
          ? mappingByCode.get(warehouse.externalBranchCode) ?? null
          : null,
      })),
    };
  }

  async catalogVersion(actor: AuthUser, sourceSchema?: string) {
    const snapshot = await this.activeSnapshot(actor.organizationId, sourceSchema);
    return { version: snapshot.activeRunId, sourceSchema: snapshot.sourceSchema, publishedAt: snapshot.activeRun.publishedAt };
  }

  /** Send a new catalog whenever its published snapshot or cost visibility changes. */
  async offlineReferenceCatalog(actor: AuthUser, sourceSchema = 'IAS20261', knownVersion?: string) {
    const snapshot = await this.activeSnapshot(actor.organizationId, sourceSchema);
    const movementRun = await this.prisma.oracleMovementSyncRun.findFirst({
      where: {
        organizationId: actor.organizationId,
        sourceSchema: snapshot.sourceSchema,
        status: { in: ['validated', 'published'] },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    const catalogVersion = `${snapshot.sourceSchema}:${snapshot.activeRunId}:${movementRun?.id ?? 'none'}:${actor.permissions.includes('mobile.inventory.cost.view') ? 'cost' : 'standard'}`;
    if (knownVersion === catalogVersion) return { catalogVersion };
    const [warehouses, items, publishedMovements] = await Promise.all([
      this.prisma.oracleWarehouseMirror.findMany({
        where: { syncRunId: snapshot.activeRunId, organizationId: actor.organizationId, isInactive: false },
        select: { externalWarehouseCode: true, nameAr: true, externalBranchCode: true, isInactive: true },
        orderBy: { externalWarehouseCode: 'asc' },
      }),
      this.prisma.oracleItemMirror.findMany({
        where: { syncRunId: snapshot.activeRunId, organizationId: actor.organizationId, isInactive: false, isService: false },
        select: {
          externalItemCode: true, nameAr: true, externalGroupCode: true, isInactive: true,
          group: { select: { nameAr: true } },
          units: {
            where: { isInactive: false },
            select: {
              unitName: true, packageSize: true, isMainUnit: true, isPurchaseUnit: true,
              isStockUnit: true, isSaleUnit: true, barcode: true, isInactive: true, salePrice: true,
              stockRows: {
                where: { isInactive: false },
                select: {
                  externalWarehouseCode: true,
                  availableQuantity: true,
                  primaryCost: true,
                  weightedAverageCost: true,
                  warehouse: { select: { nameAr: true } },
                },
                orderBy: { externalWarehouseCode: 'asc' },
              },
            },
            orderBy: [{ packageSize: 'asc' }, { unitName: 'asc' }],
          },
        },
        orderBy: { externalItemCode: 'asc' },
      }),
      this.prisma.oracleInventoryMovementMirror.findMany({
        where: {
          organizationId: actor.organizationId,
          syncRunId: movementRun?.id ?? '00000000-0000-0000-0000-000000000000',
        },
        select: {
          id: true,
          externalItemCode: true,
          movementDate: true,
          documentType: true,
          billDocumentType: true,
          documentNumber: true,
          documentSequence: true,
          unitName: true,
          packageSize: true,
          itemQuantity: true,
          primaryQuantity: true,
          inOut: true,
          externalWarehouseCode: true,
          description: true,
          itemCost: true,
          stockCost: true,
          currencyCode: true,
          externalCustomerCode: true,
        },
        orderBy: [{ movementDate: 'desc' }, { documentSequence: 'desc' }],
      }),
    ]);
    const offlineCustomerCodes = [...new Set(publishedMovements
      .map((movement) => movement.externalCustomerCode)
      .filter((code): code is string => Boolean(code)))];
    const offlineCustomers = offlineCustomerCodes.length ? await this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId, externalCustomerCode: { in: offlineCustomerCodes } },
      select: { id: true, name: true, externalCustomerCode: true },
    }) : [];
    const offlineCustomerByCode = new Map(offlineCustomers.map((customer) => [customer.externalCustomerCode, customer]));
    const offlineSourceByMovement = new Map<string, ItemPricingSource>(publishedMovements.map((row) => [
      row.id,
      { itemCost: row.itemCost, stockCost: row.stockCost, currencyCode: row.currencyCode },
    ] as const));
    const movementsByItem = new Map<string, typeof publishedMovements>();
    for (const movement of publishedMovements) {
      const list = movementsByItem.get(movement.externalItemCode) ?? [];
      list.push(movement);
      movementsByItem.set(movement.externalItemCode, list);
    }
    // Each item/warehouse balance may be repeated in several units. Count the
    // physical quantity once; inventory value comes from signed Oracle movement
    // quantity × STK_COST so it matches the accounting valuation used by ONYX.
    const stockRows = items.flatMap((item) => {
      const seenWarehouses = new Set<string>();
      return [...item.units].sort((a, b) => Number(b.isStockUnit) - Number(a.isStockUnit)
        || Number(b.isMainUnit) - Number(a.isMainUnit) || Number(a.packageSize) - Number(b.packageSize))
        .flatMap((unit) => unit.stockRows.filter((row) => {
          if (!['101', '102', '103', '104'].includes(row.externalWarehouseCode)
            || seenWarehouses.has(row.externalWarehouseCode)) return false;
          seenWarehouses.add(row.externalWarehouseCode);
          return true;
        }).map((row) => ({
        availableQuantity: Number(row.availableQuantity),
        packageSize: Number(unit.packageSize),
        cost: row.weightedAverageCost == null
          ? row.primaryCost == null ? null : Number(row.primaryCost)
          : Number(row.weightedAverageCost),
      })));
    });
    const stockQuantity = stockRows.reduce((summary, row) => {
      const primaryQuantity = row.availableQuantity * row.packageSize;
      summary.totalPrimaryQuantity += primaryQuantity;
      return summary;
    }, { totalPrimaryQuantity: 0 });
    const valuation = summarizeOracleMovementValuation(publishedMovements);
    return {
      snapshotRunId: snapshot.activeRunId,
      catalogVersion,
      warehouses,
      items: items.map((item) => {
        const itemMovements = movementsByItem.get(item.externalItemCode) ?? [];
        const baseUnit = item.units.find((unit) => unit.isMainUnit)
          ?? item.units.find((unit) => unit.isStockUnit)
          ?? item.units.find((unit) => Number(unit.packageSize) === 1)
          ?? item.units[0];
        const movementPricing = summarizeMovementPricing(itemMovements, offlineSourceByMovement, {
          unitName: baseUnit?.unitName ?? 'الوحدة الأساسية',
          packageSize: Number(baseUnit?.packageSize ?? 1),
        });
        const priceSourceUnit = baseUnit?.salePrice != null
          ? baseUnit
          : item.units.find((unit) => unit.salePrice != null);
        const normalizedSalePrice = priceSourceUnit?.salePrice == null || !baseUnit
          ? null
          : Number(priceSourceUnit.salePrice) * Number(baseUnit.packageSize) / Number(priceSourceUnit.packageSize);
        return ({
        externalItemCode: item.externalItemCode,
        nameAr: item.nameAr,
        externalGroupCode: item.externalGroupCode,
        group: item.group,
        isInactive: item.isInactive,
        _count: { units: item.units.length },
        units: item.units.map(({ stockRows: _stockRows, ...unit }) => ({
          ...unit,
          packageSize: unit.packageSize.toString(),
          salePrice: unit.salePrice?.toString() ?? null,
        })),
        stockRows: item.units.flatMap((unit) => unit.stockRows.map((row) => ({
          externalWarehouseCode: row.externalWarehouseCode,
          unitName: unit.unitName,
          packageSize: unit.packageSize.toString(),
          availableQuantity: row.availableQuantity.toString(),
          primaryCost: row.primaryCost?.toString() ?? null,
          weightedAverageCost: row.weightedAverageCost?.toString() ?? null,
          warehouse: row.warehouse,
        }))),
        activity: summarizeItemActivity(itemMovements),
        pricing: {
          baseUnitName: baseUnit?.unitName ?? null,
          lastSupplyCost: movementPricing.lastSupplyPrices.length === 1
            ? movementPricing.lastSupplyPrices[0].price : null,
          lastSupplyPrices: movementPricing.lastSupplyPrices,
          weightedAverageCost: item.units.flatMap((unit) => unit.stockRows)
            .find((row) => row.weightedAverageCost !== null)?.weightedAverageCost?.toString() ?? null,
          salePrice: normalizedSalePrice == null ? null : String(Math.round((normalizedSalePrice + Number.EPSILON) * 1e12) / 1e12),
          salePriceUnit: baseUnit?.unitName ?? null,
          averageSalePrice: movementPricing.averageSalePrices.length === 1
            ? movementPricing.averageSalePrices[0].price : null,
          lastSalePrice: movementPricing.lastSalePrices.length === 1
            ? movementPricing.lastSalePrices[0].price : null,
          lastSalePrices: movementPricing.lastSalePrices,
          averageSalePrices: movementPricing.averageSalePrices,
          noteAr: normalizedSalePrice == null
            ? 'سعر البيع الافتراضي غير موجود في اللقطة الحالية. أعد نشر لقطة INVI008 المحدثة.'
            : `الأسعار معروضة تلقائيًا حسب الوحدة الأساسية (${baseUnit?.unitName ?? 'غير محددة'}). آخر ومتوسط البيع محسوبان من مرآة حركات Oracle لكل عملة دون خلط العملات.`,
        },
        movements: itemMovements.slice(0, 20).map((movement) => ({
          ...movement,
          documentTypeLabelAr: inventoryDocumentTypeLabel(movement.documentType, movement.billDocumentType),
          customer: movement.externalCustomerCode
            ? offlineCustomerByCode.get(movement.externalCustomerCode) ?? null
            : null,
          itemCost: offlineSourceByMovement.get(movement.id)?.itemCost?.toString() ?? null,
          stockCost: offlineSourceByMovement.get(movement.id)?.stockCost?.toString() ?? null,
          currencyCode: offlineSourceByMovement.get(movement.id)?.currencyCode ?? null,
          itemQuantity: movement.itemQuantity.toString(),
          primaryQuantity: movement.primaryQuantity.toString(),
        })),
      }); }),
      summary: {
        snapshot: {
          runId: snapshot.activeRunId,
          sourceSchema: snapshot.sourceSchema,
          publishedAt: snapshot.activeRun.publishedAt,
        },
        counts: {
          items: items.length,
          warehouses: warehouses.length,
          stockBalances: items.reduce((total, item) => total
            + item.units.reduce((unitTotal, unit) => unitTotal + unit.stockRows.length, 0), 0),
        },
        valuation: {
          ...valuation,
          totalPrimaryQuantity: stockQuantity.totalPrimaryQuantity,
          currencyCode: 'SAR',
          warehouseCodes: ['101', '102', '103', '104'],
          basis: 'مجموع حركات Oracle: الكمية × تكلفة المخزون مع اتجاه الوارد/المنصرف',
        },
      },
    };
  }

  async stockBalances(actor: AuthUser, query: OracleInventoryStockQueryDto) {
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();
    const where: Prisma.OracleStockBalanceMirrorWhereInput = {
      syncRunId: snapshot.activeRunId,
      organizationId: actor.organizationId,
      ...(query.itemCode ? { externalItemCode: query.itemCode.trim() } : {}),
      ...(query.warehouseCode ? { externalWarehouseCode: query.warehouseCode.trim() } : {}),
      ...(query.positiveOnly ? { availableQuantity: { gt: 0 } } : {}),
      ...(search ? {
        OR: [
          { externalItemCode: { contains: search, mode: 'insensitive' } },
          { itemUnit: { item: { nameAr: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.oracleStockBalanceMirror.count({ where }),
      this.prisma.oracleStockBalanceMirror.findMany({
        where,
        select: {
          externalItemCode: true,
          unitName: true,
          packageSize: true,
          externalWarehouseCode: true,
          externalWarehouseGroupCode: true,
          availableQuantity: true,
          primaryCost: true,
          weightedAverageCost: true,
          isInactive: true,
          itemUnit: { select: { item: { select: { nameAr: true, isInactive: true } } } },
          warehouse: { select: { nameAr: true, externalBranchCode: true, isInactive: true } },
        },
        orderBy: [{ externalItemCode: 'asc' }, { externalWarehouseCode: 'asc' }, { unitName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      snapshotRunId: snapshot.activeRunId,
      items: rows.map((row) => ({
        externalItemCode: row.externalItemCode,
        itemName: row.itemUnit.item.nameAr,
        itemInactive: row.itemUnit.item.isInactive,
        unitName: row.unitName,
        packageSize: row.packageSize.toString(),
        externalWarehouseCode: row.externalWarehouseCode,
        warehouseName: row.warehouse.nameAr,
        externalBranchCode: row.warehouse.externalBranchCode,
        warehouseInactive: row.warehouse.isInactive,
        externalWarehouseGroupCode: row.externalWarehouseGroupCode,
        availableQuantity: row.availableQuantity.toString(),
        primaryCost: row.primaryCost?.toString() ?? null,
        weightedAverageCost: row.weightedAverageCost?.toString() ?? null,
        isInactive: row.isInactive,
      })),
    };
  }
}
