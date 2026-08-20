import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  OracleInventoryItemsQueryDto,
  OracleInventorySourceQueryDto,
  OracleInventoryStockQueryDto,
  OracleInventoryWarehousesQueryDto,
} from './dto/oracle-inventory-query.dto';

@Injectable()
export class OracleInventoryReadService {
  constructor(private readonly prisma: PrismaService) {}

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
      where: { organizationId: actor.organizationId, sourceSchema: snapshot.sourceSchema },
      orderBy: [{ extractedAt: 'desc' }, { startedAt: 'desc' }],
      select: { id: true, status: true, extractedAt: true },
    });
    const [itemGroups, items, itemUnits, warehouseGroups, warehouses, stockBalances, branchMappings, valuationRows, decisionRows, movementCoverage] = await Promise.all([
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
        )
        SELECT
          COALESCE(SUM(available_quantity * package_size * COALESCE(weighted_average_cost, primary_cost, 0)), 0) AS total_value,
          COALESCE(SUM(available_quantity * package_size), 0) AS primary_quantity,
          COUNT(*) FILTER (WHERE COALESCE(weighted_average_cost, primary_cost) IS NOT NULL) AS valued_rows,
          COUNT(*) FILTER (WHERE COALESCE(weighted_average_cost, primary_cost) IS NULL AND available_quantity <> 0) AS missing_cost_rows
        FROM ranked WHERE rn = 1
      `),
      this.prisma.$queryRaw<Array<{
        item_code: string;
        item_name: string;
        source_updated_at: Date | null;
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
        SELECT st.external_item_code AS item_code,
               i.name_ar AS item_name,
               i.source_updated_at,
               st.current_quantity,
               st.stock_value,
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
        FROM stock st
        JOIN oracle_items_mirror i
          ON i.sync_run_id = ${runId}::uuid AND i.external_item_code = st.external_item_code
        LEFT JOIN movement m ON m.external_item_code = st.external_item_code
        LEFT JOIN monthly_stats ms ON ms.external_item_code = st.external_item_code
      `),
      movementRun ? this.prisma.oracleInventoryMovementMirror.aggregate({
        where: { syncRunId: movementRun.id, organizationId: actor.organizationId },
        _count: { _all: true },
        _min: { movementDate: true },
        _max: { movementDate: true },
      }) : Promise.resolve({ _count: { _all: 0 }, _min: { movementDate: null }, _max: { movementDate: null } }),
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
        risk = 'نفاد فعلي مع وجود طلب حديث؛ توجد مخاطرة فقد مبيعات.';
        recommendation = 'توفير كمية تغطي 60 يومًا بعد مراجعة أوامر الشراء المفتوحة.';
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
    const classificationSummary = Object.values(assessments.reduce<Record<string, {
      type: string; count: number; stockValue: number; recommendedSupplyQuantity: number;
    }>>((summary, item) => {
      const bucket = (summary[item.type] ??= { type: item.type, count: 0, stockValue: 0, recommendedSupplyQuantity: 0 });
      bucket.count += 1;
      bucket.stockValue += item.stockValue;
      bucket.recommendedSupplyQuantity += item.recommendedSupplyQuantity;
      return summary;
    }, {})).sort((a, b) => b.count - a.count);
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
        basis: 'stock-unit quantity × package size × Oracle weighted-average cost',
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
    const where: Prisma.OracleItemMirrorWhereInput = {
      syncRunId: snapshot.activeRunId,
      organizationId: actor.organizationId,
      ...(query.groupCode ? { externalGroupCode: query.groupCode.trim() } : {}),
      ...(query.status === 'inactive' ? { isInactive: true } : query.status === 'all' ? {} : { isInactive: false }),
      ...(search ? {
        OR: [
          { externalItemCode: { contains: search, mode: 'insensitive' } },
          { nameAr: { contains: search, mode: 'insensitive' } },
          { units: { some: { barcode: { contains: search, mode: 'insensitive' } } } },
        ],
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
        referencePrimaryCost: row.referencePrimaryCost?.toString() ?? null,
        referenceWeightedAverageCost: row.referenceWeightedAverageCost?.toString() ?? null,
      })),
    };
  }

  async item(actor: AuthUser, externalItemCode: string, query: OracleInventorySourceQueryDto) {
    const snapshot = await this.activeSnapshot(actor.organizationId, query.sourceSchema);
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
    }), this.prisma.publishedInventoryMovement.findMany({
      where: {
        organizationId: actor.organizationId,
        sourceSchema: snapshot.sourceSchema,
        externalItemCode,
        reversedAt: null,
      },
      select: {
        id: true,
        sourceFingerprint: true,
        movementDate: true,
        documentType: true,
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
        publishedAt: true,
      },
      orderBy: [{ movementDate: 'desc' }, { documentSequence: 'desc' }],
      take: 100,
    })]);
    if (!item) throw new NotFoundException('Oracle inventory item was not found in the active snapshot.');
    const movementIds = movements.map((movement) => movement.id);
    const movementLedger = movementIds.length ? await this.prisma.$queryRaw<Array<{
      platform_entity_id: string;
      external_customer_code: string | null;
    }>>(Prisma.sql`
      SELECT DISTINCT ON (p.id) p.id AS platform_entity_id, m.external_customer_code
      FROM published_inventory_movements p
      JOIN oracle_inventory_movements_mirror m
        ON m.organization_id=p.organization_id AND m.source_fingerprint=p.source_fingerprint
      WHERE p.id IN (${Prisma.join(movementIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY p.id, m.loaded_at DESC
    `) : [];
    const customerCodeByMovement = new Map<string, string>();
    for (const ledger of movementLedger) {
      if (ledger.external_customer_code) customerCodeByMovement.set(ledger.platform_entity_id, ledger.external_customer_code);
    }
    const customerCodes = [...new Set(customerCodeByMovement.values())];
    const customers = customerCodes.length ? await this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId, externalCustomerCode: { in: customerCodes } },
      select: { id: true, name: true, externalCustomerCode: true },
    }) : [];
    const customerByCode = new Map(customers.map((customer) => [customer.externalCustomerCode, customer]));
    return {
      ...item,
      snapshotRunId: snapshot.activeRunId,
      referencePrimaryCost: item.referencePrimaryCost?.toString() ?? null,
      referenceWeightedAverageCost: item.referenceWeightedAverageCost?.toString() ?? null,
      units: item.units.map(({ stockRows: _stockRows, ...unit }) => ({
        ...unit,
        packageSize: unit.packageSize.toString(),
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
        customer: customerByCode.get(customerCodeByMovement.get(movement.id) ?? '') ?? null,
        packageSize: movement.packageSize.toString(),
        itemQuantity: movement.itemQuantity.toString(),
        freeQuantity: movement.freeQuantity.toString(),
        primaryQuantity: movement.primaryQuantity.toString(),
        primaryFreeQuantity: movement.primaryFreeQuantity.toString(),
      })),
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
