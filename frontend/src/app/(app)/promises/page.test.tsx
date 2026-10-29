import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PromisesPage from './page';

const { promiseRows } = vi.hoisted(() => ({ promiseRows: [] as any[] }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { page: 1, totalPages: 1, total: promiseRows.length, items: promiseRows },
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/auth', () => ({ useCan: () => (permission: string) => permission === 'customers.read' }));
vi.mock('@/components/app-shell', () => ({ PageHeader: () => <h1>وعود السداد</h1> }));

const promise = {
  id: 'promise-1', customerId: 'customer-1', promiseDate: '2026-08-17', dueDate: '2026-08-18',
  expectedAmount: 25000, currencyCode: 'YER', status: 'fulfilled', statusReason: null,
  fulfilledAmount: 25000, notes: null,
  customer: { id: 'customer-1', name: 'محمد علي محمد القحوي', externalCustomerCode: '30794' },
  collector: { user: { fullName: 'المحصل التجريبي الأول' } },
};
afterEach(() => { cleanup(); promiseRows.length = 0; });

it('distinguishes a late settlement without replacing the original due date or missed history', () => {
  promiseRows.push({ ...promise, settlementDate: '2026-10-11', settledLate: true, missedDueDate: '2026-08-18' });
  render(<PromisesPage />);
  expect(screen.getByText('تم السداد بعد الموعد')).toBeTruthy();
  expect(screen.getByText(/تاريخ السداد:/)).toHaveTextContent('11/10/2026');
  expect(screen.getByText(/سبق تسجيل الوعد كغير منفذ/)).toHaveTextContent('18/08/2026');
  expect(screen.getAllByText('18/08/2026')).toHaveLength(1);
});

it('does not mark an on-time receipt late just because an old automated failure was preserved', () => {
  promiseRows.push({ ...promise, dueDate: '2026-10-08', settlementDate: '2026-10-06',
    settledLate: false, missedDueDate: '2026-10-08' });
  render(<PromisesPage />);
  expect(screen.queryByText('تم السداد بعد الموعد')).toBeNull();
  expect(within(screen.getByRole('table')).getByText('منفذ')).toBeTruthy();
  expect(screen.getByText(/تاريخ السداد:/)).toHaveTextContent('06/10/2026');
  expect(screen.getByText(/سبق تسجيل الوعد كغير منفذ/)).toBeTruthy();
});

it('renders old API results without inventing a settlement date', () => {
  promiseRows.push(promise);
  render(<PromisesPage />);
  expect(within(screen.getByRole('table')).getByText('منفذ')).toBeTruthy();
  expect(screen.queryByText(/تاريخ السداد:/)).toBeNull();
});
