import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { ORACLE_INVENTORY_DECISION_TYPES } from './dto/oracle-inventory-query.dto';
import { OracleInventoryReadService } from './oracle-inventory-read.service';

const decimal = (value: number) => new Prisma.Decimal(value);
const now = new Date('2026-09-15T12:00:00Z');
const row = (code: string, overrides: Record<string, unknown> = {}) => ({
  item_code: code, item_name: code, source_updated_at: null,
  has_stock_balance: true, current_quantity: decimal(100), stock_value: decimal(100),
  outbound_30: decimal(30), outbound_90: decimal(90), outbound_180: decimal(180),
  outbound_365: decimal(250), inbound_90: decimal(0),
  last_movement_at: now, last_outbound_at: now,
  first_movement_at: new Date('2026-01-01'), movement_count: 10n,
  active_months: 8n, peak_month_outbound: decimal(30), ...overrides,
});

function reader(rows: ReturnType<typeof row>[], coverageDays = 258) {
  const countModel = () => ({ count: jest.fn().mockResolvedValue(rows.length) });
  const prisma = {
    oracleInventoryActiveSnapshot: { findMany: jest.fn().mockResolvedValue([{
      activeRunId: 'inventory-run', sourceSchema: 'IAS20261', activatedAt: now,
      activeRun: { status: 'published', extractedAt: now, publishedAt: now, validatedAt: now },
    }]) },
    oracleMovementSyncRun: { findFirst: jest.fn().mockResolvedValue({ id: 'movement-run', status: 'published', extractedAt: now }) },
    oracleItemGroupMirror: countModel(), oracleItemMirror: countModel(),
    oracleItemUnitMirror: countModel(), oracleWarehouseGroupMirror: countModel(),
    oracleWarehouseMirror: countModel(), oracleStockBalanceMirror: countModel(),
    oracleBranchMapping: { findMany: jest.fn().mockResolvedValue([]) },
    oracleInventoryMovementMirror: { aggregate: jest.fn().mockResolvedValue({
      _count: { _all: 100 }, _min: { movementDate: new Date(now.getTime() - (coverageDays - 1) * 86400000) },
      _max: { movementDate: now },
    }) },
    reservation: { aggregate: jest.fn().mockResolvedValue({ _sum: { remainingTons: null } }) },
    $queryRaw: jest.fn().mockImplementation((sql: Prisma.Sql) => {
      if (sql.sql.includes('AS outbound_30')) return Promise.resolve(rows);
      return Promise.resolve([]);
    }),
  };
  return new OracleInventoryReadService(prisma as any, {} as any);
}

describe('inventory decision coverage and pagination', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(now); });
  afterEach(() => { jest.useRealTimers(); });
  const actor = { organizationId: 'organization' } as any;

  it('includes all nine zero-result categories even with no eligible items', async () => {
    const result = await reader([]).summary(actor, {});
    expect(result.classificationSummary.map((entry) => entry.type)).toEqual([...ORACLE_INVENTORY_DECISION_TYPES]);
    expect(result.classificationSummary.every((entry) => entry.count === 0)).toBe(true);
    expect(result.decisions).toEqual([]);
    expect(result.decisionPagination.total).toBe(0);
  });

  it('flags missing balance with recent outbound as preliminary and preserves negative-stock priority', async () => {
    const result = await reader([
      row('missing-demand', { has_stock_balance: false, current_quantity: decimal(0), stock_value: decimal(0) }),
      row('missing-no-demand', { has_stock_balance: false, current_quantity: decimal(0), outbound_90: decimal(0) }),
      row('explicit-zero', { current_quantity: decimal(0) }),
      row('negative', { current_quantity: decimal(-1) }),
    ]).summary(actor, {});
    expect(result.decisions.find((item) => item.itemCode === 'missing-demand')).toMatchObject({
      type: 'stockout_risk', hasStockBalance: false, confidence: 'preliminary', recommendedSupplyQuantity: 60,
    });
    expect(result.decisions.find((item) => item.itemCode === 'explicit-zero')).toMatchObject({
      type: 'stockout_risk', hasStockBalance: true,
    });
    expect(result.decisions.find((item) => item.itemCode === 'negative')?.type).toBe('negative_stock');
    expect(result.decisions.some((item) => item.itemCode === 'missing-no-demand')).toBe(false);
    expect(result.classificationSummary.find((item) => item.type === 'no_stock_no_demand')?.count).toBe(1);
  });

  it('keeps total recommendation counts independent of the 60-row default and category pages', async () => {
    const rows = [
      ...Array.from({ length: 65 }, (_, index) => row(`reorder-${index}`, { current_quantity: decimal(10) })),
      row('normal'),
    ];
    const service = reader(rows);
    const first = await service.summary(actor, {});
    expect(first.decisions).toHaveLength(60);
    expect(first.decisionPagination).toEqual({ page: 1, limit: 60, total: 65, totalPages: 2 });
    const last = await service.summary(actor, { decisionType: 'reorder', decisionLimit: 24, decisionPage: 3 });
    expect(last.decisions).toHaveLength(17);
    expect(last.decisions.every((item) => item.type === 'reorder')).toBe(true);
    expect(last.classificationSummary).toEqual(first.classificationSummary);
    const empty = await service.summary(actor, { decisionType: 'negative_stock', decisionLimit: 24 });
    expect(empty.decisions).toEqual([]);
    expect(empty.decisionPagination.total).toBe(0);
    expect(empty.classificationSummary.find((item) => item.type === 'negative_stock')?.count).toBe(0);
  });

  it('preserves existing positive-stock classifications and the insufficient-history branch', async () => {
    const result = await reader([
      row('reorder', { current_quantity: decimal(10) }),
      row('dead', { outbound_90: decimal(0), last_outbound_at: null }),
      row('seasonal', { active_months: 3n, peak_month_outbound: decimal(150) }),
      row('slow', { current_quantity: decimal(500) }),
      row('overstock', { current_quantity: decimal(250) }),
      row('fast', { current_quantity: decimal(30) }),
    ]).summary(actor, {});
    expect(Object.fromEntries(result.decisions.map((item) => [item.itemCode, item.type]))).toEqual({
      reorder: 'reorder', dead: 'dead_stock', seasonal: 'seasonal_candidate',
      slow: 'slow_moving', overstock: 'overstock', fast: 'fast_moving',
    });
    const shortHistory = await reader([row('new', { movement_count: 0n, outbound_90: decimal(0) })], 90).summary(actor, {});
    expect(shortHistory.decisions[0].type).toBe('insufficient_history');
  });
});
