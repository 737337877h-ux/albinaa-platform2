'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtMoney, CCY_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Empty, Input, Money, Pagination, Select } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

interface CustomerListItem {
  id: string;
  externalCustomerCode: string | null;
  name: string;
  phonePrimary: string | null;
  region: string | null;
  status: string;
  branch: { id: string; name: string } | null;
  currentCollector: { id: string; name: string } | null;
  balances: { currency: string; balance: number; updatedAt: string }[];
}

interface CustomersResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: CustomerListItem[];
}

type SortBy = 'name' | 'code' | 'createdAt' | 'balance';
type SortDir = 'asc' | 'desc';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useMemo(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function CustomersPage() {
  const can = useCan();
  const canRead = can('customers.read');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);

  const [balanceState, setBalanceState] = useState<string>('');
  const [currency, setCurrency] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const query = useQuery<CustomersResponse>({
    queryKey: ['customers', debouncedSearch, balanceState, currency, status, sortBy, sortDir, page],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '25');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (balanceState) params.set('balanceState', balanceState);
      if (currency) params.set('currency', currency);
      if (status) params.set('status', status);
      if (sortBy) params.set('sortBy', sortBy);
      if (sortDir) params.set('sortDir', sortDir);
      return api<CustomersResponse>(`/customers?${params.toString()}`);
    },
    enabled: canRead,
  });

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  const activeFilters = [balanceState, currency, status].filter(Boolean).length;

  const sortIcon = (col: SortBy) => {
    if (sortBy !== col) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض قائمة العملاء" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="العملاء" />

      <Card>
        {/* شريط البحث والفلاتر */}
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-concrete-400" aria-hidden />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="بحث بالاسم، الكود، أو رقم الهاتف…"
                className="pr-10 pl-9"
                aria-label="بحث في العملاء"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-concrete-100 dark:hover:bg-white/10"
                  aria-label="مسح البحث"
                >
                  <X className="h-3.5 w-3.5 text-concrete-400" />
                </button>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => setShowFilters((v) => !v)}
              className="relative shrink-0"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">الفلاتر</span>
              {activeFilters > 0 && (
                <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-pine-700 text-[10px] text-white">
                  {activeFilters}
                </span>
              )}
            </Button>
          </div>

          {/* الفلاتر الم展开 */}
          {showFilters && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">حالة الرصيد</span>
                <Select
                  value={balanceState}
                  onChange={(e) => { setBalanceState(e.target.value); setPage(1); }}
                >
                  <option value="">الكل</option>
                  <option value="debtor">مديون</option>
                  <option value="creditor">دائن</option>
                  <option value="zero">صافي</option>
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">العملة</span>
                <Select
                  value={currency}
                  onChange={(e) => { setCurrency(e.target.value); setPage(1); }}
                >
                  <option value="">الكل</option>
                  {Object.entries(CCY_AR).map(([code, name]) => (
                    <option key={code} value={code}>{name} ({code})</option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">الحالة</span>
                <Select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                >
                  <option value="">الكل</option>
                  <option value="active">نشط</option>
                  <option value="inactive">غير نشط</option>
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">ترتيب حسب</span>
                <Select
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value as SortBy); setPage(1); }}
                >
                  <option value="name">الاسم</option>
                  <option value="code">الكود</option>
                  <option value="createdAt">تاريخ الإنشاء</option>
                  <option value="balance">الرصيد</option>
                </Select>
              </label>
              {activeFilters > 0 && (
                <div className="col-span-2 sm:col-span-4">
                  <Button
                    variant="ghost"
                    onClick={() => { setBalanceState(''); setCurrency(''); setStatus(''); setPage(1); }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    مسح الفلاتر
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* الجدول */}
        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!query.data?.items?.length}
          emptyTitle="لا يوجد عملاء"
          emptyHint={debouncedSearch || activeFilters ? 'جرّب تغيير معايير البحث أو الفلاتر' : undefined}
          skeletonClassName="h-64"
        >
          {query.data && (
            <>
              <Table>
                <THead cols={['العميل', 'المنطقة', 'الرصيد', 'المحصل', 'الحالة']} />
                <tbody>
                  {query.data.items.map((c) => (
                    <TRow key={c.id} onClick={() => window.location.href = `/customers/${c.id}`}>
                      <TD>
                        <div>
                          <Link
                            href={`/customers/${c.id}`}
                            className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.name}
                          </Link>
                          {c.externalCustomerCode && (
                            <p className="text-xs text-concrete-500" dir="ltr">{c.externalCustomerCode}</p>
                          )}
                          {c.phonePrimary && (
                            <p className="text-xs text-concrete-400" dir="ltr">{c.phonePrimary}</p>
                          )}
                        </div>
                      </TD>
                      <TD className="text-concrete-600 dark:text-concrete-400">{c.region ?? '—'}</TD>
                      <TD>
                        {c.balances.length > 0 ? (
                          <div className="space-y-0.5">
                            {c.balances.map((b) => (
                              <Money key={b.currency} value={b.balance} currency={b.currency} signed />
                            ))}
                          </div>
                        ) : (
                          <span className="text-concrete-400">—</span>
                        )}
                      </TD>
                      <TD className="text-concrete-600 dark:text-concrete-400">
                        {c.currentCollector?.name ?? 'غير مسنّد'}
                      </TD>
                      <TD>
                        <Badge tone={c.status === 'active' ? 'pine' : 'neutral'}>
                          {c.status === 'active' ? 'نشط' : 'غير نشط'}
                        </Badge>
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
              <Pagination page={query.data.page} totalPages={query.data.totalPages} onPage={setPage} />
            </>
          )}
        </DataState>
      </Card>
    </div>
  );
}
