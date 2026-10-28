'use client';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays, ChevronDown, Download, Eye, FileCheck2, HandCoins,
  Hash, MapPin, RefreshCw, RotateCcw, Search, UserRound,
} from 'lucide-react';
import { api, apiFileBlob } from '@/lib/api';
import { ReceiptRequestList } from '@/components/receipt-request-list';
import { useCan } from '@/lib/auth';
import {
  fmtDate, fmtDateTime, fmtMoney, CCY_AR, COLLECTION_STATUS_AR,
} from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, CardHeader, Field, Input, Pagination, Select, Textarea } from '@/components/ui/primitives';
import {
  accountLinkKey, allowedPartyCurrencies, approvedReceiptCollectionRows, automaticCollector, filterParties, resolvePartyLink,
  oracleCurrencyLabel,
  type OracleParty, type OracleRequestCatalog,
} from '@/lib/oracle-test-requests';

/* ────────────────────────────── Types ────────────────────────────────── */

interface CollectionCustomer {
  id: string | null;
  name: string;
  externalCustomerCode: string | null;
}

interface CollectionCollector {
  id?: string | null;
  user: { fullName: string };
}

interface CollectionMethod {
  name: string;
}

interface CollectionBranch {
  name: string;
}

interface CollectionItem {
  id: string;
  customerId: string | null;
  currencyCode: string;
  amount: number;
  collectedAt: string;
  status: string;
  receiptNumber: string | null;
  referenceNumber: string | null;
  notes: string | null;
  customer: CollectionCustomer;
  collector: CollectionCollector | null;
  method: CollectionMethod | null;
  branch: CollectionBranch | null;
  source?: 'platform_collection' | 'oracle_approved_receipt' | 'oracle_direct_receipt';
  receiptAttachment?: {
    id: string;
    fileName: string;
    previewPath: string;
    uploadedAt: string;
    uploaderName?: string | null;
  } | null;
}

interface CollectionsResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  totalsByCurrency: Record<string, number>;
  items: CollectionItem[];
}

interface NameId {
  id: string;
  name: string;
}

interface CollectorOption {
  id: string;
  user: { fullName: string };
}

interface OracleCurrencyCatalog {
  schema: string;
  currencies: Array<{ code: string; nameAr: string; rate: string; local: boolean }>;
}

interface ReceiptDryRunResult {
  valid?: boolean;
  issues?: Array<{ message?: string }>;
  localAmount?: number;
  counterpartyLocalAmount?: number;
  localBalance?: number;
  localCurrency?: string;
  saveAllowed?: boolean;
  saveBlockedReason?: string;
}

interface OracleReceiptRequest {
  kind: 'receipt'; requestNo: string; requestSerial: string; description?: string | null;
  collectorNo?: string | null; collectorName?: string | null; collectorId?: string | null;
  status: 'pending_approval' | 'approved' | 'rejected' | 'inactive' | 'cancelled' | 'unknown'; createdAt?: string | null;
  statusLabel?: string; statusVerified?: boolean;
  amount?: number | string | null; currencyCode?: string | null;
  finalReceiptId?: string | null;
  platformCustomerId?: string | null; platformCustomerCode?: string | null; recipientName?: string | null;
  attachment?: { id: string; fileName: string; previewPath: string; uploadedAt: string };
}

interface OracleReceiptRequestsResult {
  items: Array<OracleReceiptRequest | Record<string, unknown>>;
  partial?: boolean;
}

/* ────────────────────────────── Helpers ──────────────────────────────── */

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function CurrencySelect({ value, options, onChange }: {
  value: string;
  options: OracleCurrencyCatalog['currencies'];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.code === value);
  return <div className="relative" dir="rtl" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-concrete-200 bg-white px-3 py-2 text-right text-sm focus:border-pine-500 dark:border-line dark:bg-surface-3 dark:text-ink-hi"
      onClick={() => setOpen((current) => !current)}
    >
      <span className={selected ? '' : 'text-concrete-400'}>{selected ? oracleCurrencyLabel(selected.code, selected.nameAr) : 'اختر العملة…'}</span>
      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
    </button>
    {open && <div role="listbox" className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-1 p-1 text-right shadow-xl">
      {options.map((item) => <button
        key={item.code}
        type="button"
        role="option"
        aria-selected={item.code === value}
        className={`block w-full rounded-lg px-3 py-2.5 text-right text-sm hover:bg-surface-3 ${item.code === value ? 'bg-brand/10 font-semibold' : ''}`}
        onClick={() => { onChange(item.code); setOpen(false); }}
      >{oracleCurrencyLabel(item.code, item.nameAr)}</button>)}
      {options.length === 0 && <p className="px-3 py-3 text-sm text-ink-mid">لا توجد عملات متاحة للحساب المحدد.</p>}
    </div>}
  </div>;
}

/* ────────────────────────────── Validation ────────────────────────────── */

const reverseSchema = z.object({
  reason: z.string().min(3, 'السبب مطلوب (3 أحرف على الأقل)'),
});

type ReverseForm = z.infer<typeof reverseSchema>;

/* ────────────────────────────── Status Helpers ───────────────────────── */

function statusBadgeTone(status: string): string {
  switch (status) {
    case 'approved':
    case 'matched':
      return 'pine';
    case 'recorded':
      return 'neutral';
    case 'handed_to_cashier':
      return 'credit';
    case 'reversed':
      return 'debt';
    default:
      return 'neutral';
  }
}

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function CollectionsPage() {
  const can = useCan();
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';
  const canRead = can('customers.read');
  const canRequestReceipt = can('oracle_test_requests.receipt.create');
  const canReverse = can('collections.reverse');
  const canHandover = can('cash.receive');
  const canExport = can('reports.export');
  const canListCollectors = can('users.manage');
  const qc = useQueryClient();

  /* ──── Filter State ──── */
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);
  const [fromDate, setFromDate] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('fromDate') ?? '') ? searchParams.get('fromDate')! : '');
  const [toDate, setToDate] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('toDate') ?? '') ? searchParams.get('toDate')! : '');
  const [statusFilter, setStatusFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [collectorFilter, setCollectorFilter] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  /* ──── Dialog State ──── */
  const [receiptOpen, setReceiptOpen] = useState(searchParams.get('new') === '1');
  const [reverseItem, setReverseItem] = useState<CollectionItem | null>(null);
  const [handoverItem, setHandoverItem] = useState<CollectionItem | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [receiptPreviewLoading, setReceiptPreviewLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get('new') === '1') setReceiptOpen(true);
  }, [searchParams]);

  const closeReceipt = () => {
    setReceiptOpen(false);
    if (searchParams.get('new') === '1') {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('new');
      router.replace(`/collections?${params.toString()}`, { scroll: false });
    }
  };

  /* ──── Queries ──── */
  const query = useQuery<CollectionsResponse>({
    queryKey: ['collections', 'list', customerId, debouncedSearch, fromDate, toDate, statusFilter, currencyFilter, branchFilter, collectorFilter, page],
    queryFn: () => {
      const p = new URLSearchParams();
      if (customerId) p.set('customerId', customerId);
      p.set('page', String(page));
      p.set('limit', '25');
      if (fromDate) p.set('fromDate', fromDate);
      if (toDate) p.set('toDate', toDate);
      if (statusFilter) p.set('status', statusFilter);
      if (currencyFilter) p.set('currency', currencyFilter);
      if (branchFilter) p.set('branchId', branchFilter);
      if (collectorFilter) p.set('collectorId', collectorFilter);
      return api<CollectionsResponse>(`/collections?${p.toString()}`, { cache: 'no-store' });
    },
    enabled: canRead,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const receiptRequests = useQuery<OracleReceiptRequestsResult>({
    queryKey: ['oracle-test-requests-created', 'collections-receipts'],
    queryFn: () => api('/oracle-test-requests/created', { cache: 'no-store' }),
    enabled: canRequestReceipt && !customerId,
    refetchInterval: 30_000,
  });
  const visibleReceiptRequests = (customerId ? [] : receiptRequests.data?.items ?? [])
    .filter((item): item is OracleReceiptRequest => item.kind === 'receipt' && item.status !== 'approved')
    .slice(0, 20);
  const closeReceiptPreview = () => {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview.url);
    setReceiptPreview(null);
  };
  const loadReceiptPreview = async (previewPath: string, fileName: string) => {
    setReceiptPreviewLoading(true);
    try {
      const blob = await apiFileBlob(previewPath);
      const url = URL.createObjectURL(blob);
      setReceiptPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { url, fileName };
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذر فتح صورة الإيصال', 'err');
    } finally {
      setReceiptPreviewLoading(false);
    }
  };
  const previewRequestReceipt = async (item: OracleReceiptRequest) => {
    if (!item.attachment) return;
    await loadReceiptPreview(item.attachment.previewPath, item.attachment.fileName);
  };
  const previewCollectionReceipt = async (item: CollectionItem) => {
    if (!item.receiptAttachment) return;
    await loadReceiptPreview(item.receiptAttachment.previewPath, item.receiptAttachment.fileName);
  };

  const branchesQuery = useQuery<NameId[]>({
    queryKey: ['branches'],
    queryFn: () => api<NameId[]>('/branches'),
    enabled: canRead,
  });

  const collectorsQuery = useQuery<CollectorOption[]>({
    queryKey: ['collectors', 'collection-report-options'],
    queryFn: () => api<CollectorOption[]>('/collectors'),
    enabled: canRead && canListCollectors,
  });

  const approvedOracleRows = useMemo<CollectionItem[]>(() => {
    if (customerId) return [];
    const existingReferences = (query.data?.items ?? [])
      .flatMap((item) => [item.referenceNumber, item.receiptNumber])
      .filter((value): value is string => Boolean(value));
    return approvedReceiptCollectionRows(
      (receiptRequests.data?.items ?? []).filter((item): item is OracleReceiptRequest => item.kind === 'receipt'),
      existingReferences,
    ).filter((row) => {
      const date = row.collectedAt.slice(0, 10);
      if (statusFilter && statusFilter !== 'approved') return false;
      if (currencyFilter && row.currencyCode !== currencyFilter) return false;
      if (fromDate && date && date < fromDate) return false;
      if (toDate && date && date > toDate) return false;
      if (collectorFilter && row.collector?.id !== collectorFilter) return false;
      if (branchFilter) return false;
      return true;
    });
  }, [customerId, branchFilter, collectorFilter, currencyFilter, fromDate, query.data?.items, receiptRequests.data?.items, statusFilter, toDate]);

  const displayTotals = useMemo(() => {
    const totals = { ...(query.data?.totalsByCurrency ?? {}) };
    for (const row of approvedOracleRows) totals[row.currencyCode] = (totals[row.currencyCode] ?? 0) + row.amount;
    return totals;
  }, [approvedOracleRows, query.data?.totalsByCurrency]);

  function reportParams(pageNumber: number) {
    const p = new URLSearchParams({ page: String(pageNumber), limit: '100' });
    if (customerId) p.set('customerId', customerId);
    if (fromDate) p.set('fromDate', fromDate);
    if (toDate) p.set('toDate', toDate);
    if (statusFilter) p.set('status', statusFilter);
    if (currencyFilter) p.set('currency', currencyFilter);
    if (branchFilter) p.set('branchId', branchFilter);
    if (collectorFilter) p.set('collectorId', collectorFilter);
    return p;
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const first = await api<CollectionsResponse>(`/collections?${reportParams(1).toString()}`);
      const rows = [...approvedOracleRows, ...first.items];
      const pages = Math.min(first.totalPages, 100);
      for (let current = 2; current <= pages; current += 1) {
        const result = await api<CollectionsResponse>(`/collections?${reportParams(current).toString()}`);
        rows.push(...result.items);
      }
      const needle = debouncedSearch.trim().toLowerCase();
      const exported = needle
        ? rows.filter((row) => [row.customer.name, row.customer.externalCustomerCode, row.receiptNumber, row.referenceNumber]
          .some((value) => value?.toLowerCase().includes(needle)))
        : rows;
      const header = ['التاريخ', 'العميل', 'كود العميل', 'المبلغ', 'العملة', 'الطريقة', 'الفرع', 'المحصل', 'الحالة', 'المرجع', 'ملاحظات'];
      const lines = exported.map((row) => [
        row.collectedAt, row.customer.name, row.customer.externalCustomerCode, row.amount,
        row.currencyCode, row.method?.name, row.branch?.name, row.collector?.user?.fullName,
        COLLECTION_STATUS_AR[row.status] ?? row.status, row.receiptNumber ?? row.referenceNumber, row.notes,
      ].map(csvCell).join(','));
      const blob = new Blob([`\uFEFF${header.map(csvCell).join(',')}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `collections-report-${fromDate || 'all'}-${toDate || 'all'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast(`تم تصدير ${exported.length} عملية تحصيل`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذر تصدير التقرير', 'err');
    } finally {
      setExporting(false);
    }
  }

  /* ──── Client-side search ──── */
  const items = [
    ...(page === 1 ? approvedOracleRows : []),
    ...(query.data?.items ?? []),
  ].sort((left, right) => new Date(right.collectedAt).getTime() - new Date(left.collectedAt).getTime());
  const filtered = debouncedSearch
    ? items.filter((c) => {
        const s = debouncedSearch.toLowerCase();
        return (
          (c.customer?.name ?? '').toLowerCase().includes(s) ||
          c.customer?.externalCustomerCode?.toLowerCase().includes(s) ||
          c.referenceNumber?.toLowerCase().includes(s) ||
          c.receiptNumber?.toLowerCase().includes(s) ||
          c.notes?.toLowerCase().includes(s)
        );
      })
    : items;

  /* ──── Reverse Mutation ──── */
  const reverseMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/collections/${id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      toast('تم إرسال طلب العكس للموافقة من مستخدم ثانٍ', 'ok');
      setReverseItem(null);
      qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Handover Mutation ──── */
  const handoverMut = useMutation({
    mutationFn: ({ id, receiptNumber }: { id: string; receiptNumber?: string }) =>
      api(`/collections/${id}/handover`, {
        method: 'POST',
        body: JSON.stringify(receiptNumber ? { receiptNumber } : {}),
      }),
    onSuccess: () => {
      toast('تم التسليم للصندوق بنجاح', 'ok');
      setHandoverItem(null);
      qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Permission Gate ──── */
  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض التحصيلات (customers.read)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="التحصيلات"
        action={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={query.isFetching} onClick={() => { void query.refetch(); if (canRequestReceipt && !customerId) void receiptRequests.refetch(); }}>
              <RefreshCw className="h-4 w-4" /> تحديث السجل
            </Button>
            {canExport && (
              <Button variant="secondary" loading={exporting} onClick={exportCsv}>
                <Download className="h-4 w-4" aria-hidden /> تصدير CSV/Excel
              </Button>
            )}
            {canRequestReceipt && (
              <Button onClick={() => setReceiptOpen(true)}>
                <FileCheck2 className="h-4 w-4" aria-hidden />
                طلب سند قبض جديد
              </Button>
            )}
          </div>
        )}
      />

      <Card className="border-pine-600/25">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-bold text-iron-900 dark:text-concrete-100">مسار التحصيل المعتمد يبدأ بطلب سند قبض</p>
            <p className="mt-1 text-sm text-concrete-600 dark:text-concrete-300">
              تُستخدم هذه الشاشة لمراجعة التحصيلات السابقة. الطلب الجديد يُفحص ويُعتمد أولًا، ولا ينخفض رصيد العميل من تسجيل مباشر في المنصة.
            </p>
          </div>
          {canRequestReceipt && <Button variant="secondary" onClick={() => setReceiptOpen(true)}>فتح طلب سند قبض</Button>}
        </div>
      </Card>

      {canRequestReceipt && <Card>
        <CardHeader title={`طلبات سندات القبض (${visibleReceiptRequests.length})`} action={<Button variant="secondary" loading={receiptRequests.isFetching} onClick={() => receiptRequests.refetch()}><RefreshCw className="h-4 w-4" />تحديث الطلبات</Button>} />
        {receiptRequests.isError && <div className="p-4 text-sm text-debt-600">تعذر قراءة طلبات سندات القبض؛ ستظل التحصيلات المحلية أدناه متاحة.</div>}
        {!receiptRequests.isLoading && !receiptRequests.isError && visibleReceiptRequests.length === 0 && <div className="p-4 text-sm text-ink-mid">لا توجد طلبات بانتظار الاعتماد. السندات المعتمدة موجودة في سجل التحصيلات أدناه.</div>}
        <ReceiptRequestList items={visibleReceiptRequests} onPreview={previewRequestReceipt} />
      </Card>}

      {/* ──── إجمالي العملات ──── */}
      {query.data && Object.keys(displayTotals).length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-4 px-4 py-3">
            <span className="text-xs font-medium text-concrete-500">إجمالي التحصيلات:</span>
            {Object.entries(displayTotals).map(([ccy, total]) => (
              <Badge key={ccy} tone="pine">
                {CCY_AR[ccy] ?? ccy}: {fmtMoney(total)}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card>
        {/* ──── شريط الفلاتر ──── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-ink-hi">سجل التحصيلات {fromDate || toDate ? `· ${fromDate ? fmtDate(fromDate) : 'البداية'} — ${toDate ? fmtDate(toDate) : 'اليوم'}` : '· جميع التواريخ'}</p>
          <p className="text-xs text-ink-mid">{query.data ? `${query.data.total} تحصيل · الصفحة ${query.data.page} من ${Math.max(1,query.data.totalPages)}` : 'جارٍ قراءة السجل'}</p>
        </div>
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالعميل، الكود، أو المرجع…"
              aria-label="بحث في التحصيلات"
            />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">الحالة</span>
              <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">الكل</option>
                <option value="recorded">مسجلة</option>
                <option value="handed_to_cashier">مسلمة للصندوق</option>
                <option value="matched">مطابقة</option>
                <option value="approved">معتمدة</option>
                <option value="reversed">معكوسة</option>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">العملة</span>
              <Select value={currencyFilter} onChange={(e) => { setCurrencyFilter(e.target.value); setPage(1); }}>
                <option value="">الكل</option>
                {Object.entries(CCY_AR).map(([code, name]) => (
                  <option key={code} value={code}>{name} ({code})</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">من تاريخ</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">إلى تاريخ</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">الفرع</span>
              <Select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}>
                <option value="">كل الفروع</option>
                {(branchesQuery.data ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </Select>
            </label>
            {canListCollectors && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">المحصل</span>
                <Select value={collectorFilter} onChange={(e) => { setCollectorFilter(e.target.value); setPage(1); }}>
                  <option value="">كل المحصلين</option>
                  {(collectorsQuery.data ?? []).map((collector) => <option key={collector.id} value={collector.id}>{collector.user.fullName}</option>)}
                </Select>
              </label>
            )}
          </div>
        </div>

        {/* ──── الجدول ──── */}
        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!filtered.length}
          emptyTitle="لا توجد تحصيلات"
          emptyHint={debouncedSearch || fromDate || toDate || statusFilter || currencyFilter ? 'جرّب تغيير معايير البحث أو الفلاتر' : undefined}
          skeletonClassName="h-64"
        >
          <div className="space-y-3 p-3 sm:p-4">
            <div className="hidden grid-cols-[minmax(0,1.45fr)_minmax(9rem,.65fr)_minmax(10rem,.75fr)_minmax(13rem,1fr)_auto] gap-4 px-4 text-xs font-medium text-ink-mid lg:grid">
              <span>العميل والتاريخ</span>
              <span>المبلغ</span>
              <span>الحالة والطريقة</span>
              <span>المحصل والمرجع</span>
              <span>إجراء</span>
            </div>
            {filtered.map((c) => {
              const customerName = c.customer?.name?.trim() || 'عميل غير محدد';
              return (
                <article
                  key={c.id}
                  className="group rounded-2xl border border-line bg-surface-1 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-pine-500/40 hover:shadow-md"
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(9rem,.65fr)_minmax(10rem,.75fr)_minmax(13rem,1fr)_auto] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pine-50 text-lg font-bold text-pine-700 dark:bg-pine-900/40 dark:text-pine-200">
                        {customerName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        {c.customer?.id ? (
                          <Link href={`/customers/${c.customer.id}`} className="block truncate font-bold text-ink-hi hover:text-pine-600 hover:underline">
                            {customerName}
                          </Link>
                        ) : <p className="truncate font-bold text-ink-hi">{customerName}</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mid">
                          {c.customer?.externalCustomerCode && <span dir="ltr" className="font-mono font-semibold text-amber-700 dark:text-amber-300">#{c.customer.externalCustomerCode}</span>}
                          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{fmtDateTime(c.collectedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-pine-50/80 px-3 py-2.5 dark:bg-pine-900/25">
                      <p className="text-xs text-ink-mid">المبلغ المحصل</p>
                      <p className="mt-0.5 text-lg font-black text-pine-700 dark:text-pine-100" dir="ltr">{fmtMoney(c.amount)}</p>
                      <p className="text-xs font-medium text-pine-600 dark:text-pine-300">{CCY_AR[c.currencyCode] ?? c.currencyCode}</p>
                    </div>

                    <div className="space-y-2">
                      <Badge tone={statusBadgeTone(c.status) as 'pine' | 'neutral' | 'credit' | 'debt'}>
                        {COLLECTION_STATUS_AR[c.status] ?? c.status}
                      </Badge>
                      <p className="text-sm font-medium text-ink-hi">{c.method?.name ?? 'طريقة غير محددة'}</p>
                      {c.branch?.name && <p className="flex items-center gap-1 text-xs text-ink-mid"><MapPin className="h-3.5 w-3.5" />{c.branch.name}</p>}
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-hi"><UserRound className="h-4 w-4 text-pine-500" />{c.collector?.user?.fullName ?? 'محصل غير محدد'}</p>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-mid">
                        <Hash className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate" dir="ltr">{c.receiptNumber ?? c.referenceNumber ?? 'بدون مرجع'}</span>
                      </div>
                      {c.referenceNumber && c.receiptNumber && c.referenceNumber !== c.receiptNumber && (
                        <p className="truncate ps-5 text-[11px] text-ink-mid" dir="ltr">{c.referenceNumber}</p>
                      )}
                      {c.notes && <p className="line-clamp-2 pt-1 text-xs text-ink-mid">{c.notes}</p>}
                      {c.receiptAttachment && <p className="text-[11px] text-ink-mid">رفعها: {c.receiptAttachment.uploaderName ?? 'المحصل'} · {fmtDateTime(c.receiptAttachment.uploadedAt)}</p>}
                    </div>

                    <div className="flex items-center justify-end gap-1 border-t border-line pt-3 lg:border-0 lg:pt-0">
                      {c.receiptAttachment && (
                        <button onClick={() => previewCollectionReceipt(c)} className="rounded-lg p-2 text-pine-600 hover:bg-pine-50 dark:text-pine-200 dark:hover:bg-pine-900/30" aria-label="معاينة صورة الإيصال">
                          <Eye className="h-4 w-4" />
                        </button>
                      )}
                      {c.status === 'recorded' && canHandover && (
                        <button onClick={() => setHandoverItem(c)} className="rounded-lg p-2 text-concrete-400 hover:bg-credit-50 hover:text-credit-600 dark:hover:bg-credit-700/20 dark:hover:text-credit-400" aria-label="تسليم للصندوق">
                          <HandCoins className="h-4 w-4" />
                        </button>
                      )}
                      {c.source !== 'oracle_approved_receipt' && c.source !== 'oracle_direct_receipt' && c.status !== 'reversed' && canReverse && (
                        <button onClick={() => setReverseItem(c)} className="rounded-lg p-2 text-concrete-400 hover:bg-debt-50 hover:text-debt-600 dark:hover:bg-debt-700/20 dark:hover:text-debt-400" aria-label="عكس التحصيل">
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
            <Pagination
              page={query.data?.page ?? 1}
              totalPages={Math.max(query.data?.totalPages ?? 1, Math.ceil(((query.data?.total ?? 0) + approvedOracleRows.length) / 25))}
              onPage={setPage}
            />
          </div>
        </DataState>
      </Card>

      {/* ──── إجمالي النتائج ──── */}
      {query.data && (
        <p className="text-center text-xs text-concrete-400">
          إجمالي النتائج: {query.data.total + approvedOracleRows.length} تحصيل — الصفحة {query.data.page} من {Math.max(query.data.totalPages, Math.ceil((query.data.total + approvedOracleRows.length) / 25))}
        </p>
      )}

      <ReceiptRequestDialog
        open={receiptOpen}
        onClose={closeReceipt}
        requestedCustomerCode={searchParams.get('customerCode')?.trim() ?? ''}
      />

      <Dialog open={!!receiptPreview} onClose={closeReceiptPreview} title="معاينة صورة الإيصال" className="sm:max-w-3xl">
        {receiptPreview && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={receiptPreview.url} alt="صورة الإيصال المرفوعة" className="max-h-[70vh] w-full rounded-xl bg-concrete-50 object-contain" />
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs text-ink-mid" dir="ltr">{receiptPreview.fileName}</span>
              <a href={receiptPreview.url} download={receiptPreview.fileName} className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-surface-2">تنزيل الصورة</a>
            </div>
          </div>
        )}
      </Dialog>
      {receiptPreviewLoading && <span className="sr-only" role="status">جار تحميل صورة الإيصال</span>}

      {/* ──── عكس تحصيل ──── */}
      <ReverseDialog
        item={reverseItem}
        onClose={() => setReverseItem(null)}
        onSubmit={(reason) => {
          if (reverseItem) reverseMut.mutate({ id: reverseItem.id, reason });
        }}
        loading={reverseMut.isPending}
      />

      {/* ──── تسليم للصندوق ──── */}
      <HandoverDialog
        item={handoverItem}
        onClose={() => setHandoverItem(null)}
        onSubmit={(receiptNumber) => {
          if (handoverItem) handoverMut.mutate({ id: handoverItem.id, receiptNumber: receiptNumber || undefined });
        }}
        loading={handoverMut.isPending}
      />
    </div>
  );
}

type ReceiptState = {
  paymentMethod: 'cash' | 'bank_transfer';
  customerCode: string;
  accountKey: string;
  partyCurrency: string;
  partyAmount: string;
  locationCode: string;
  locationCurrency: string;
  locationAmount: string;
  description: string;
  referenceNo: string;
  noticeNo: string;
  collectorCode: string;
  recipientName: string;
  nextFollowupDate: string;
};

const emptyReceipt = (): ReceiptState => ({
  paymentMethod: 'cash', customerCode: '', accountKey: '', partyCurrency: '', partyAmount: '',
  locationCode: '', locationCurrency: '', locationAmount: '', description: '', referenceNo: '', noticeNo: '', collectorCode: '', recipientName: '', nextFollowupDate: '',
});

function ReceiptRequestDialog({ open, onClose, requestedCustomerCode }: { open: boolean; onClose: () => void; requestedCustomerCode: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ReceiptState>(emptyReceipt);
  const [customerSearch, setCustomerSearch] = useState('');
  const [reference, setReference] = useState('');
  const [approvedPayload, setApprovedPayload] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(emptyReceipt());
    setCustomerSearch('');
    setReference(crypto.randomUUID());
    setApprovedPayload('');
  }, [open]);

  const currencies = useQuery<OracleCurrencyCatalog>({
    queryKey: ['oracle-test-currencies'],
    queryFn: () => api('/oracle-test-requests/currencies'),
    enabled: open,
  });
  const catalog = useQuery<OracleRequestCatalog>({
    queryKey: ['oracle-test-request-catalog', 'receipt'],
    queryFn: () => api('/oracle-test-requests/catalog?purpose=receipt'),
    enabled: open,
  });

  const selectedCustomer = catalog.data?.parties.customers.find((item) => item.code === form.customerCode);
  const selectedLink = resolvePartyLink(selectedCustomer, form.accountKey);
  const partyCurrencyCodes = allowedPartyCurrencies(selectedCustomer, form.accountKey);
  const locations = form.paymentMethod === 'cash' ? catalog.data?.cashboxes ?? [] : catalog.data?.banks ?? [];
  const selectedLocation = locations.find((item) => item.code === form.locationCode);
  const assignedCollector = automaticCollector([selectedCustomer]);
  const selectedCollector = assignedCollector ?? catalog.data?.collectors.find((item) => item.code === form.collectorCode);
  const customerResults = useMemo(
    () => filterParties(catalog.data?.parties.customers ?? [], customerSearch).slice(0, 30),
    [catalog.data, customerSearch],
  );

  const selectCustomer = (customer: OracleParty) => {
    const link = customer.linkedAccounts.length === 1 ? customer.linkedAccounts[0] : undefined;
    const key = link ? accountLinkKey(link) : '';
    const allowed = allowedPartyCurrencies(customer, key);
    setForm((state) => ({
      ...state,
      customerCode: customer.code,
      accountKey: key,
      partyCurrency: allowed.length === 1 ? allowed[0] : '',
      description: state.description || `تحصيل من ${customer.nameAr}`,
      collectorCode: '',
      recipientName: customer.nameAr,
    }));
    setCustomerSearch('');
    setApprovedPayload('');
  };

  useEffect(() => {
    if (!open || !requestedCustomerCode || !catalog.data || form.customerCode) return;
    const customer = catalog.data.parties.customers.find((item) => item.code === requestedCustomerCode);
    if (customer) selectCustomer(customer);
  }, [open, requestedCustomerCode, catalog.data, form.customerCode]);

  const payload = useMemo(() => ({
    kind: 'receipt',
    paymentMethod: form.paymentMethod,
    externalReference: `platform-voucher:${reference}`,
    currencyCode: form.locationCurrency,
    amount: Number(form.locationAmount),
    cashOrBankNo: Number(form.locationCode),
    description: form.description,
    referenceNo: form.referenceNo || null,
    noticeNo: form.paymentMethod === 'bank_transfer' ? form.noticeNo || null : null,
    collectorNo: selectedCollector ? Number(selectedCollector.code) : null,
    commissionPercent: selectedCollector?.commissionPercent ?? null,
    recipientName: form.recipientName.trim() || selectedCustomer?.nameAr || null,
    platformCustomerCode: selectedCustomer?.code || null,
    nextFollowupDate: form.nextFollowupDate || null,
    lines: [{
      currencyCode: form.partyCurrency,
      amount: Number(form.partyAmount),
      accountCode: selectedLink?.accountCode || '',
      analyticalAccountCode: selectedLink?.analyticalAccountCode || '',
      analyticalType: selectedLink?.analyticalType || 0,
      description: form.description,
    }],
  }), [form, reference, selectedCollector, selectedCustomer, selectedLink]);
  const payloadKey = JSON.stringify(payload);

  const readyIssue = !selectedCustomer ? 'اختر العميل' :
    !selectedLink ? 'اختر الحساب المرتبط بالعميل' :
    !form.partyCurrency || Number(form.partyAmount) <= 0 ? 'أكمل عملة ومبلغ طرف العميل' :
    !selectedLocation ? `اختر ${form.paymentMethod === 'cash' ? 'الصندوق' : 'البنك'}` :
    !form.locationCurrency || Number(form.locationAmount) <= 0 ? 'أكمل عملة ومبلغ الصندوق أو البنك' :
    !form.description.trim() ? 'أدخل بيان السند' :
    !form.recipientName.trim() ? 'أدخل اسم المستلم' :
    form.paymentMethod === 'bank_transfer' && (!form.referenceNo.trim() || !form.noticeNo.trim()) ? 'رقم المرجع ورقم الإشعار مطلوبان للتحويل البنكي' :
    !selectedLocation.currencyCodes.includes(form.locationCurrency) ? 'عملة الصندوق أو البنك غير مفعلة في IAS20261' :
    !selectedLink.currencyCodes.includes(form.partyCurrency) ? 'عملة العميل غير مفعلة للحساب المرتبط في IAS20261' : '';

  const dryRun = useMutation<ReceiptDryRunResult>({
    mutationFn: () => api('/oracle-test-requests/vouchers/dry-run', { method: 'POST', body: payloadKey }),
    onSuccess: (result) => {
      if (result.valid === false) {
        setApprovedPayload('');
        toast(result.issues?.map((item) => item.message).filter(Boolean).join('، ') || 'فحص الطلب يحتاج معالجة', 'err');
      } else if (result.saveAllowed === false) {
        setApprovedPayload('');
        toast(result.saveBlockedReason || 'نجح الفحص، والحفظ ما زال محجوبًا بأمان', 'ok');
      } else {
        setApprovedPayload(payloadKey);
        toast('نجح فحص الطلب — لم تُجرَ أي كتابة في Oracle', 'ok');
      }
    },
    onError: (error: Error) => { setApprovedPayload(''); toast(error.message, 'err'); },
  });
  const create = useMutation<{ created: boolean; requestNo: string }>({
    mutationFn: () => api('/oracle-test-requests/vouchers', { method: 'POST', body: payloadKey }),
    onSuccess: (result) => {
      toast(result.created ? `تم حفظ طلب سند القبض رقم ${result.requestNo}` : `الطلب موجود مسبقًا برقم ${result.requestNo}`, 'ok');
      qc.invalidateQueries({ queryKey: ['oracle-test-requests-created'] });
      onClose();
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });

  return <Dialog open={open} onClose={onClose} title="طلب سند قبض جديد" className="sm:max-w-2xl">
    <div className="space-y-4">
      <div className="rounded-lg border border-pine-600/25 bg-pine-50 p-3 text-sm text-pine-800 dark:bg-pine-900/20 dark:text-pine-100">
        الأطراف والحسابات والعملات تُقرأ من IAS20261 فقط. لن تتغير مديونية العميل إلا بعد اعتماد السند ونشر حركته.
      </div>
      {catalog.isLoading || currencies.isLoading ? <p className="text-sm text-concrete-500">جار تحميل حسابات العملاء والصناديق والعملات…</p> : null}
      {catalog.isError || currencies.isError ? <div role="alert" className="rounded-lg border border-debt-600/30 p-3 text-sm text-debt-600">تعذر تحميل خريطة سند القبض. تحقق من اتصال بوابة Oracle ثم أعد المحاولة.</div> : null}

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2 p-1">
        <Button variant={form.paymentMethod === 'cash' ? 'primary' : 'ghost'} onClick={() => { setForm((state) => ({ ...state, paymentMethod: 'cash', locationCode: '', locationCurrency: '' })); setApprovedPayload(''); }}>نقدي</Button>
        <Button variant={form.paymentMethod === 'bank_transfer' ? 'primary' : 'ghost'} onClick={() => { setForm((state) => ({ ...state, paymentMethod: 'bank_transfer', locationCode: '', locationCurrency: '' })); setApprovedPayload(''); }}>تحويل بنكي</Button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">العميل *</label>
        {selectedCustomer ? <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 p-3"><span><strong>{selectedCustomer.nameAr}</strong><span className="mr-2 text-xs text-concrete-500" dir="ltr">{selectedCustomer.code}</span></span><Button variant="ghost" onClick={() => { setForm((state) => ({ ...state, customerCode: '', accountKey: '', partyCurrency: '', collectorCode: '', recipientName: '' })); setApprovedPayload(''); }}>تغيير</Button></div> : <>
          <div className="relative"><Search className="absolute right-3 top-3.5 h-4 w-4 text-concrete-400" /><Input className="pr-10" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="ابحث باسم العميل أو الكود أو الهاتف…" /></div>
          {customerSearch && <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-1">{customerResults.map((customer) => <button key={customer.code} type="button" onClick={() => selectCustomer(customer)} className="block w-full border-b border-line px-3 py-2 text-right text-sm last:border-0 hover:bg-surface-2"><strong>{customer.nameAr}</strong><span className="mr-2 text-xs text-concrete-500" dir="ltr">{customer.code}</span></button>)}</div>}
        </>}
      </div>

      {selectedCustomer && selectedCustomer.linkedAccounts.length > 1 && <Field label="حساب العميل المرتبط"><Select value={form.accountKey} onChange={(event) => { const key = event.target.value; const allowed = allowedPartyCurrencies(selectedCustomer, key); setForm((state) => ({ ...state, accountKey: key, partyCurrency: allowed.length === 1 ? allowed[0] : '' })); setApprovedPayload(''); }}><option value="">اختر الحساب</option>{selectedCustomer.linkedAccounts.map((link) => <option key={accountLinkKey(link)} value={accountLinkKey(link)}>{link.accountName} — {link.analyticalAccountName}</option>)}</Select></Field>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="مبلغ العميل *"><Input type="number" min="0.01" value={form.partyAmount} onChange={(event) => { setForm((state) => ({ ...state, partyAmount: event.target.value })); setApprovedPayload(''); }} /></Field>
        <Field label="عملة العميل *"><CurrencySelect value={form.partyCurrency} options={(currencies.data?.currencies ?? []).filter((item) => partyCurrencyCodes.includes(item.code))} onChange={(value) => { setForm((state) => ({ ...state, partyCurrency: value })); setApprovedPayload(''); }} /></Field>
        <Field label={form.paymentMethod === 'cash' ? 'الصندوق *' : 'البنك *'}><Select value={form.locationCode} onChange={(event) => { setForm((state) => ({ ...state, locationCode: event.target.value, locationCurrency: '' })); setApprovedPayload(''); }}><option value="">اختر</option>{locations.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.nameAr}</option>)}</Select></Field>
        <Field label={form.paymentMethod === 'cash' ? 'مبلغ الصندوق *' : 'مبلغ البنك *'}><Input type="number" min="0.01" value={form.locationAmount} onChange={(event) => { setForm((state) => ({ ...state, locationAmount: event.target.value })); setApprovedPayload(''); }} /></Field>
        <Field label={form.paymentMethod === 'cash' ? 'عملة الصندوق *' : 'عملة البنك *'}><CurrencySelect value={form.locationCurrency} options={(currencies.data?.currencies ?? []).filter((item) => selectedLocation?.currencyCodes.includes(item.code))} onChange={(value) => { setForm((state) => ({ ...state, locationCurrency: value })); setApprovedPayload(''); }} /></Field>
        <Field label="البيان *"><Input value={form.description} onChange={(event) => { setForm((state) => ({ ...state, description: event.target.value })); setApprovedPayload(''); }} /></Field>
        <Field label="اسم المستلم *"><Input value={form.recipientName} onChange={(event) => { setForm((state) => ({ ...state, recipientName: event.target.value })); setApprovedPayload(''); }} placeholder="اسم الشخص الذي سلّم المبلغ" /></Field>
        {form.paymentMethod === 'bank_transfer' && <><Field label="رقم المرجع *"><Input value={form.referenceNo} onChange={(event) => { setForm((state) => ({ ...state, referenceNo: event.target.value })); setApprovedPayload(''); }} /></Field><Field label="رقم الإشعار *"><Input value={form.noticeNo} onChange={(event) => { setForm((state) => ({ ...state, noticeNo: event.target.value })); setApprovedPayload(''); }} /></Field></>}
        <Field label="موعد متابعة المتبقي (للتحصيل الجزئي)"><Input type="date" value={form.nextFollowupDate} onChange={(event) => { setForm((state) => ({ ...state, nextFollowupDate: event.target.value })); setApprovedPayload(''); }} /></Field>
      </div>

      {selectedCustomer && <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">{assignedCollector ? <>المحصل المسند تلقائيًا: <strong>{assignedCollector.nameAr}</strong></> : <Field label="المحصل"><Select value={form.collectorCode} onChange={(event) => { setForm((state) => ({ ...state, collectorCode: event.target.value })); setApprovedPayload(''); }}><option value="">بدون محصل</option>{catalog.data?.collectors.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.nameAr}</option>)}</Select></Field>}</div>}
      {readyIssue && <div className="rounded-lg border border-hazard-600/25 p-3 text-sm text-hazard-700">{readyIssue}</div>}
      {dryRun.data?.valid && <div className="rounded-lg border border-credit-600/25 bg-credit-50 p-3 text-sm text-credit-700 dark:bg-credit-700/10"><p>{dryRun.data.saveBlockedReason || 'فحص الطلب ناجح — لم تُجرَ أي كتابة في Oracle.'}</p><p className="mt-1">الصندوق/البنك محليًا: {dryRun.data.localAmount ?? '—'} — العميل محليًا: {dryRun.data.counterpartyLocalAmount ?? '—'} — الفرق: {dryRun.data.localBalance ?? '—'} {dryRun.data.localCurrency ?? ''}</p></div>}
      <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button variant="secondary" loading={dryRun.isPending} disabled={Boolean(readyIssue)} onClick={() => dryRun.mutate()}>فحص الطلب</Button><Button variant="success" loading={create.isPending} disabled={approvedPayload !== payloadKey || dryRun.data?.saveAllowed === false} onClick={() => create.mutate()}>حفظ مسودة</Button></div>
    </div>
  </Dialog>;
}

/* ────────────────────────────── Reverse Dialog ───────────────────────── */

function ReverseDialog({
  item, onClose, onSubmit, loading,
}: {
  item: CollectionItem | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ReverseForm>({
    resolver: zodResolver(reverseSchema),
  });

  useEffect(() => {
    if (!item) reset();
  }, [item, reset]);

  return (
    <Dialog open={!!item} onClose={onClose} title="طلب عكس التحصيل">
      <form onSubmit={handleSubmit((data) => onSubmit(data.reason))} className="space-y-4">
        {item && (
          <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-sm dark:border-white/10 dark:bg-iron-700">
            <p><span className="font-medium">العميل:</span> {item.customer?.name ?? '—'}</p>
            <p><span className="font-medium">المبلغ:</span> {fmtMoney(item.amount)}</p>
            <p><span className="font-medium">التاريخ:</span> {fmtDateTime(item.collectedAt)}</p>
          </div>
        )}

        <Field label="سبب العكس *" error={errors.reason?.message}>
          <Textarea
            rows={3}
            placeholder="أدخل سبب عكس التحصيل…"
            {...register('reason')}
          />
        </Field>

        <p className="text-xs text-concrete-500">
          سيُرسل الطلب للمدير المالي، ولن يُنفذ العكس حتى يعتمد مستخدم ثانٍ من شاشة مطابقة الصندوق.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button variant="danger" type="submit" loading={loading}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            إرسال طلب العكس
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Handover Dialog ──────────────────────── */

function HandoverDialog({
  item, onClose, onSubmit, loading,
}: {
  item: CollectionItem | null;
  onClose: () => void;
  onSubmit: (receiptNumber: string) => void;
  loading: boolean;
}) {
  const [receiptNumber, setReceiptNumber] = useState('');

  useEffect(() => {
    if (!item) setReceiptNumber('');
  }, [item]);

  return (
    <Dialog open={!!item} onClose={onClose} title="تسليم التحصيل للصندوق">
      <div className="space-y-4">
        {item && (
          <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-sm dark:border-white/10 dark:bg-iron-700">
            <p><span className="font-medium">العميل:</span> {item.customer?.name ?? '—'}</p>
            <p><span className="font-medium">المبلغ:</span> {fmtMoney(item.amount)}</p>
            <p><span className="font-medium">التاريخ:</span> {fmtDateTime(item.collectedAt)}</p>
          </div>
        )}

        <Field label="رقم الإيصال" error={undefined}>
          <Input
            value={receiptNumber}
            onChange={(e) => setReceiptNumber(e.target.value)}
            placeholder="أدخل رقم الإيصال (اختياري)…"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button onClick={() => onSubmit(receiptNumber)} loading={loading}>
            <HandCoins className="h-4 w-4" aria-hidden />
            تسليم للصندوق
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
