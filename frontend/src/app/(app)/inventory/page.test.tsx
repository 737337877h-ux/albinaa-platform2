import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InventoryPage from './page';

const { summary } = vi.hoisted(() => ({ summary: {
  snapshot: { sourceSchema: 'IAS20261', publishedAt: null },
  counts: { items: 6806, itemGroups: 10, itemUnits: 7653, warehouses: 4, stockBalances: 5039 },
  branchMappings: [],
  valuation: { totalInventoryCost: 0, missingCostRows: 0, currencyCode: 'SAR' },
  movementAnalysis: { movementCount: 71336, coverageDays: 258, note: 'تقييم أولي' },
  decisions: Array.from({ length: 60 }, () => ({})),
  decisionPagination: { total: 3899 },
  classificationSummary: [
    { type: 'negative_stock', count: 0 }, { type: 'stockout_risk', count: 256 },
    { type: 'reorder', count: 109 }, { type: 'dead_stock', count: 1470 },
    { type: 'slow_moving', count: 496 }, { type: 'overstock', count: 257 },
    { type: 'seasonal_candidate', count: 1184 }, { type: 'fast_moving', count: 127 },
    { type: 'insufficient_history', count: 0 }, { type: 'normal', count: 727 },
    { type: 'no_stock_no_demand', count: 2180 },
  ].map((entry) => ({ ...entry, stockValue: 0, recommendedSupplyQuantity: 0 })),
} }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'oracle-inventory-summary' ? summary
      : queryKey[0] === 'oracle-inventory-groups' ? [] : { items: [] },
    isLoading: false, isError: false, isFetching: false,
  }),
}));
vi.mock('@/lib/auth', () => ({ useCan: () => () => true }));
vi.mock('@/components/app-shell', () => ({ PageHeader: () => <h1>المخزون</h1> }));
afterEach(cleanup);

describe('inventory recommendation counters', () => {
  it('shows the total rather than the returned page length, and links all nine categories including zeros', () => {
    render(<InventoryPage />);
    expect(screen.getByText('3,899 توصية حالية')).toBeTruthy();
    expect(screen.getByText('7 تصنيفات نشطة من 9')).toBeTruthy();
    expect(screen.queryByText('60 قرار')).toBeNull();
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/inventory/decisions/'))).toHaveLength(9);
    expect(screen.getAllByText('لا توجد حالات حاليًا')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /رصيد سالب يحتاج تحقيقًا/ }).getAttribute('href')).toBe('/inventory/decisions/negative_stock');
    expect(screen.queryByText('حركة طبيعية')).toBeNull();
    expect(screen.queryByText('بلا رصيد أو طلب')).toBeNull();
  });
});
