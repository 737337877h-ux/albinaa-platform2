'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { CCY_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Input, Pagination, Select } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';

interface CustomerListItem {
  id: string;
  externalCustomerCode: string | null;
  name: string;
  region: string | null;
  status: string;
  currentCollector: { id: string; name: string } | null;
}

interface CustomersResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: CustomerListItem[];
}

interface CollectorOption {
  id: string;
  name: string;
}

interface BulkResult {
  customersSelected: number;
  assignmentsClosed: number;
  assignmentsCreated: number;
  tasksUpdated: number;
  skipped: number;
  targetCollector: string;
}

interface SmartPlan {
  selected: number; matched: number; missing: number; unchanged: number; executed?: number;
  changes: { customerId: string; customerName: string; region: string | null; collectorId: string; collectorName: string }[];
  distribution: { collectorId: string; collectorName: string; currentCustomers: number; currentTasks: number; planned: number; projectedCustomers: number }[];
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function BulkAssignmentPage() {
  const can = useCan();
  const canTransfer = can('customers.transfer');
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);
  const [region, setRegion] = useState('');
  const [collectorId, setCollectorId] = useState('');
  const [balanceState, setBalanceState] = useState('');
  const [currency, setCurrency] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetCollectorId, setTargetCollectorId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkResult | null>(null);
  const [smartPreview, setSmartPreview] = useState<SmartPlan | null>(null);

  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ['bulk-assign-customers', debouncedSearch, region, collectorId, balanceState, currency, status, page],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '25');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (region) params.set('region', region);
      if (collectorId) params.set('collectorId', collectorId);
      if (balanceState) params.set('balanceState', balanceState);
      if (currency) params.set('currency', currency);
      if (status) params.set('status', status);
      return api<CustomersResponse>(`/customers?${params.toString()}`);
    },
    enabled: canTransfer,
  });

  const collectorsQuery = useQuery<CollectorOption[]>({
    queryKey: ['bulk-assign-collectors'],
    queryFn: () => api<CollectorOption[]>('/assignments/collectors'),
    enabled: canTransfer,
  });

  const previewMut = useMutation({
    mutationFn: () =>
      api<BulkResult>('/assignments/bulk/preview', {
        method: 'POST',
        body: JSON.stringify({
          customerIds: Array.from(selected),
          collectorId: targetCollectorId,
          reason: reason || undefined,
        }),
      }),
    onSuccess: (data) => setPreview(data),
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const executeMut = useMutation({
    mutationFn: () =>
      api<BulkResult>('/assignments/bulk', {
        method: 'POST',
        body: JSON.stringify({
          customerIds: Array.from(selected),
          collectorId: targetCollectorId,
          reason: reason || undefined,
        }),
      }),
    onSuccess: (data) => {
      setPreview(data);
      setSelected(new Set());
      toast('تم تنفيذ الإسناد الجماعي بنجاح', 'ok');
      qc.invalidateQueries({ queryKey: ['bulk-assign-customers'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });
  const smartPreviewMut = useMutation({
    mutationFn: () => api<SmartPlan>('/assignments/smart/preview', {
      method: 'POST', body: JSON.stringify({ customerIds: Array.from(selected), reason: reason || undefined }),
    }),
    onSuccess: (data) => { setSmartPreview(data); setPreview(null); },
    onError: (err: Error) => toast(err.message, 'err'),
  });
  const smartExecuteMut = useMutation({
    mutationFn: () => api<SmartPlan>('/assignments/smart', {
      method: 'POST', body: JSON.stringify({ customerIds: Array.from(selected), reason: reason || undefined }),
    }),
    onSuccess: (data) => {
      setSmartPreview(data); setSelected(new Set());
      toast(`تم توزيع ${data.executed ?? data.changes.length} حسابًا حسب الحمل والمنطقة`, 'ok');
      qc.invalidateQueries({ queryKey: ['bulk-assign-customers'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const activeFilters = [region, collectorId, balanceState, currency, status].filter(Boolean).length;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreview(null);
    setSmartPreview(null);
  };

  const pageIds = useMemo(() => customersQuery.data?.items.map((c) => c.id) ?? [], [customersQuery.data]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
    setPreview(null);
    setSmartPreview(null);
  };

  const canRun = selected.size > 0 && !!targetCollectorId;

  if (!canTransfer) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية نقل العملاء (customers.transfer)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="الإسناد الجماعي" />

      <Card>
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

          {showFilters && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">المنطقة</span>
                <Input
                  value={region}
                  onChange={(e) => { setRegion(e.target.value); setPage(1); }}
                  placeholder="اسم المنطقة"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">المحصل الحالي</span>
                <Select
                  value={collectorId}
                  onChange={(e) => { setCollectorId(e.target.value); setPage(1); }}
                >
                  <option value="">الكل</option>
                  <option value="unassigned">غير مسند</option>
                  {(collectorsQuery.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </label>
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
              {activeFilters > 0 && (
                <div className="col-span-2 sm:col-span-5">
                  <Button
                    variant="ghost"
                    onClick={() => { setRegion(''); setCollectorId(''); setBalanceState(''); setCurrency(''); setStatus(''); setPage(1); }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    مسح الفلاتر
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <DataState
          isLoading={customersQuery.isLoading}
          isError={customersQuery.isError}
          error={customersQuery.error}
          onRetry={() => customersQuery.refetch()}
          isFetching={customersQuery.isFetching}
          isEmpty={!customersQuery.data?.items?.length}
          emptyTitle="لا يوجد عملاء مطابقون"
          skeletonClassName="h-64"
        >
          {customersQuery.data && (
            <>
              <Table>
                <thead>
                  <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleAllOnPage}
                        aria-label="تحديد كل عملاء هذه الصفحة"
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">العميل</th>
                    <th className="px-4 py-2.5 font-medium">المنطقة</th>
                    <th className="px-4 py-2.5 font-medium">المحصل الحالي</th>
                    <th className="px-4 py-2.5 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {customersQuery.data.items.map((c) => (
                    <TRow key={c.id} onClick={() => toggleOne(c.id)}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`تحديد ${c.name}`}
                        />
                      </TD>
                      <TD>
                        <div className="font-medium">{c.name}</div>
                        {c.externalCustomerCode && (
                          <p className="text-xs text-concrete-500" dir="ltr">{c.externalCustomerCode}</p>
                        )}
                      </TD>
                      <TD className="text-concrete-600 dark:text-concrete-400">{c.region ?? '—'}</TD>
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
              <Pagination page={customersQuery.data.page} totalPages={customersQuery.data.totalPages} onPage={setPage} />
            </>
          )}
        </DataState>
      </Card>

      <Card>
        <div className="space-y-4 p-4">
          <h3 className="font-display text-sm font-semibold">تنفيذ الإسناد الجماعي</h3>
          <p className="text-xs text-concrete-500">
            العملاء المحددون: <span className="tnum font-medium">{selected.size}</span>
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="المحصل الهدف *">
              <Select
                value={targetCollectorId}
                onChange={(e) => { setTargetCollectorId(e.target.value); setPreview(null); }}
              >
                <option value="">اختر محصلًا…</option>
                {(collectorsQuery.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="السبب" hint="اختياري">
              <Input
                value={reason}
                onChange={(e) => { setReason(e.target.value); setPreview(null); setSmartPreview(null); }}
                placeholder="سبب الإسناد/النقل"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={selected.size === 0}
              loading={smartPreviewMut.isPending}
              onClick={() => smartPreviewMut.mutate()}
            >
              معاينة التوزيع الذكي
            </Button>
            <Button
              disabled={!smartPreview || selected.size === 0}
              loading={smartExecuteMut.isPending}
              onClick={() => smartExecuteMut.mutate()}
            >
              تنفيذ التوزيع الذكي
            </Button>
            <Button
              variant="secondary"
              disabled={!canRun}
              loading={previewMut.isPending}
              onClick={() => previewMut.mutate()}
            >
              معاينة النتيجة
            </Button>
            <Button
              disabled={!canRun}
              loading={executeMut.isPending}
              onClick={() => executeMut.mutate()}
            >
              <ArrowRightLeft className="h-4 w-4" aria-hidden />
              تنفيذ الإسناد الجماعي
            </Button>
          </div>

          {preview && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-concrete-100 p-3 text-sm dark:border-white/10 sm:grid-cols-5">
              <Stat label="العملاء المحددون" value={preview.customersSelected} />
              <Stat label="إسنادات أُغلقت" value={preview.assignmentsClosed} />
              <Stat label="إسنادات جديدة" value={preview.assignmentsCreated} />
              <Stat label="مهام حُدّثت" value={preview.tasksUpdated} />
              <Stat label="تم تجاوزها" value={preview.skipped} />
            </div>
          )}
          {smartPreview && (
            <div className="space-y-3 rounded-lg border border-gold-300 bg-gold-50/40 p-3 dark:border-gold-700 dark:bg-gold-900/10">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="المحددون" value={smartPreview.selected} />
                <Stat label="سيتم نقلهم/إسنادهم" value={smartPreview.changes.length} />
                <Stat label="دون تغيير" value={smartPreview.unchanged} />
                <Stat label="غير موجود" value={smartPreview.missing} />
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {smartPreview.distribution.map((row) => <div key={row.collectorId} className="rounded-lg bg-white p-3 text-xs dark:bg-iron-800">
                  <p className="font-semibold">{row.collectorName}</p>
                  <p className="mt-1 text-concrete-500">الحالي: {row.currentCustomers} حساب • {row.currentTasks} مهمة</p>
                  <p className="mt-1 font-semibold text-pine-700 dark:text-pine-200">المقترح: +{row.planned} • الإجمالي المتوقع {row.projectedCustomers}</p>
                </div>)}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-concrete-500">{label}</p>
      <p className="tnum font-display text-lg font-semibold">{value}</p>
    </div>
  );
}
