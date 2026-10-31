'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronUp, Download, Grid3X3, List, PackageCheck, Plus, Search } from 'lucide-react';
import { api, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Field, Input, Money, Select, Textarea } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { createRequestId } from '@/lib/request-id';

const hasToken = () => typeof window !== 'undefined' && !!tokenStore.access;

interface UnitInfo { id: string; code: string; nameAr: string; weightKg: string | number | null }
interface Reservation {
  id: string;
  itemName: string | null;
  itemType: string | null;
  quantity: string | number | null;
  remainingQty: string | number | null;
  totalTons: string | number | null;
  remainingTons: string | number | null;
  unitPrice: string | number | null;
  currencyCode: string;
  status: string;
  warehouse: string | null;
  documentNumber: string | null;
  expiresAt: string | null;
  measureUnit: UnitInfo | null;
  customer: {
    id: string;
    name: string;
    externalCustomerCode: string;
    assignments: { collector: { user: { fullName: string } } }[];
  };
}
interface ReservationSummary {
  activeCount: number;
  customerCount: number;
  totalTons: number;
  totalsByCurrency: { currency: string; amount: number }[];
  averageTonPriceByCurrency: { currency: string; averageTonPrice: number; totalTons: number }[];
  unweightedUnits: { unitName: string; qty: number }[];
  expiringIn7Days: number;
}
interface CustomerSearchItem { id: string; name: string; externalCustomerCode: string | null; accountNumber?: string | null }
interface ApprovedReservationItem { itemCode: string; nameAr: string; rodsPerTon: number }

const EMPTY_CREATE_FORM = {
  customerId: '', customerLabel: '', totalTons: '', unitPrice: '', currencyCode: 'YER', documentNumber: '', notes: '', expiresAt: '',
};

const STATUS_AR: Record<string, string> = {
  open: 'نشط', partial: 'مسلّم جزئيًا', completed: 'مسلّم بالكامل', fulfilled: 'مسلّم بالكامل', cancelled: 'ملغى', expired: 'منتهي',
};

function activeReservation(row: Reservation) {
  const today = new Date().toISOString().slice(0, 10);
  return ['open', 'partial'].includes(row.status) && (!row.expiresAt || row.expiresAt.slice(0, 10) >= today);
}

export default function ReservationsPage() {
  const can = useCan();
  const allowed = can('reservations.read');
  const canCreate = can('reservations.create');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const summary = useQuery({
    queryKey: ['reservations-summary'],
    queryFn: () => api<ReservationSummary>('/reservations/summary'),
    enabled: allowed && hasToken(),
    staleTime: 60_000,
  });
  const reservations = useQuery({
    queryKey: ['reservations', 'all'],
    queryFn: () => api<Reservation[]>('/reservations'),
    enabled: allowed && hasToken(),
  });
  const approvedItems = useQuery({
    queryKey: ['reservations-approved-items'],
    queryFn: () => api<ApprovedReservationItem[]>('/reservations/approved-items'),
    enabled: allowed && hasToken(),
    staleTime: 10 * 60_000,
  });

  const filteredRows = useMemo(() => {
    const now = Date.now();
    const sevenDays = now + 7 * 86_400_000;
    const needle = search.trim().toLocaleLowerCase('ar');
    return (reservations.data ?? []).filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (currencyFilter !== 'all' && row.currencyCode !== currencyFilter) return false;
      if (needle && !`${row.customer.name} ${row.customer.externalCustomerCode ?? ''} ${row.itemName ?? ''} ${row.documentNumber ?? ''}`.toLocaleLowerCase('ar').includes(needle)) return false;
      if (expiringOnly) {
        if (!activeReservation(row) || !row.expiresAt) return false;
        const expiry = new Date(row.expiresAt).getTime();
        return expiry >= now && expiry <= sevenDays;
      }
      return true;
    });
  }, [reservations.data, expiringOnly, search, statusFilter, currencyFilter]);
  const grouped = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const row of filteredRows) map.set(row.customer.id, [...(map.get(row.customer.id) ?? []), row]);
    return [...map.values()];
  }, [filteredRows]);
  const currencies = useMemo(() => [...new Set((reservations.data ?? []).map((row) => row.currencyCode))].sort(), [reservations.data]);

  const exportCsv = () => {
    const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const header = ['العميل', 'كود العميل', 'الصنف', 'الكمية المتبقية', 'الوحدة', 'العملة', 'سعر الوحدة', 'الحالة', 'المخزن', 'المستند', 'الانتهاء'];
    const lines = filteredRows.map((row) => [
      row.customer.name, row.customer.externalCustomerCode, row.itemName, row.remainingQty,
      row.measureUnit?.nameAr, row.currencyCode, row.unitPrice, STATUS_AR[row.status] ?? row.status,
      row.warehouse, row.documentNumber, row.expiresAt?.slice(0, 10),
    ].map(cell).join(','));
    const blob = new Blob([`\uFEFF${header.map(cell).join(',')}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `reservations-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية عرض حجوزات البضاعة" /></Card>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="حجوزات البضاعة"
        action={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />حجز جديد</Button> : undefined}
      />

      <DataState
        isLoading={summary.isLoading}
        isError={summary.isError}
        error={summary.error}
        onRetry={() => summary.refetch()}
        isFetching={summary.isFetching}
        isEmpty={false}
        emptyTitle=""
        skeletonClassName="h-28"
      >
        {summary.data && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-t-2 border-t-sky-400 p-4">
              <p className="text-xs text-concrete-500">إجمالي الأطنان النشطة</p>
              <p className="tnum mt-1 font-display text-3xl font-extrabold">{fmtMoney(summary.data.totalTons)}</p>
              {summary.data.unweightedUnits.map((unit) => <p key={unit.unitName} className="text-xs text-concrete-500">+ {fmtMoney(unit.qty)} {unit.unitName}</p>)}
            </Card>
            <Card className="p-4">
              <p className="text-xs text-concrete-500">القيمة حسب العملة</p>
              <div className="mt-2 space-y-2">
                {summary.data.totalsByCurrency.map((total) => {
                  const average = summary.data.averageTonPriceByCurrency.find((item) => item.currency === total.currency);
                  return (
                    <div key={total.currency}>
                      <Money value={total.amount} currency={total.currency} />
                      {average && <p className="text-[11px] text-concrete-500">متوسط سعر الطن: {fmtMoney(average.averageTonPrice)} {total.currency}</p>}
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-concrete-500">الحجوزات النشطة</p>
              <p className="tnum mt-1 font-display text-3xl font-extrabold">{summary.data.activeCount}</p>
              <p className="text-xs text-concrete-500">لدى {summary.data.customerCount} عميل</p>
            </Card>
            <button type="button" onClick={() => setExpiringOnly((value) => !value)} className="text-right">
              <Card className="h-full border-r-4 border-r-hazard-500 p-4 transition hover:bg-hazard-50/50 dark:hover:bg-hazard-700/10">
                <p className="flex items-center gap-1.5 text-xs text-hazard-700 dark:text-hazard-400"><AlertTriangle className="h-4 w-4" /> تنتهي خلال 7 أيام</p>
                <p className="tnum mt-1 font-display text-3xl font-extrabold">{summary.data.expiringIn7Days}</p>
                <p className="text-xs text-concrete-500">{expiringOnly ? 'إظهار الكل' : 'اضغط للتصفية'}</p>
              </Card>
            </button>
          </div>
        )}
      </DataState>

      <Card className="overflow-hidden">
        <details>
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-pine-700 dark:text-pine-100">الأصناف المعتمدة ومعيار عدد الأسياخ في الطن</summary>
          <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
            {(approvedItems.data ?? []).map((item) => (
              <div key={item.itemCode} className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="font-semibold">{item.nameAr}</p>
                <p className="tnum mt-1 text-xs text-ink-mid">{item.itemCode}</p>
                <p className="tnum mt-2 text-sm font-bold text-brand">{item.rodsPerTon} سيخ / طن</p>
              </div>
            ))}
          </div>
        </details>
      </Card>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-concrete-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="بحث بالعميل أو الكود أو الصنف أو المستند" />
          </div>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-40">
            <option value="all">كل الحالات</option><option value="open">نشط</option><option value="partial">مسلم جزئيًا</option><option value="fulfilled">مكتمل</option><option value="cancelled">ملغي</option>
          </Select>
          <Select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className="w-32">
            <option value="all">كل العملات</option>{currencies.map((code) => <option key={code} value={code}>{code}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => setViewMode((value) => value === 'table' ? 'cards' : 'table')}>
            {viewMode === 'table' ? <Grid3X3 className="h-4 w-4" /> : <List className="h-4 w-4" />}{viewMode === 'table' ? 'عرض بطاقات' : 'عرض جدول'}
          </Button>
          <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" />تصدير CSV</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <PackageCheck className="h-4 w-4 text-sky-500" />
          <h2 className="text-sm font-semibold">مجمّعة حسب العميل</h2>
        </div>
        <DataState
          isLoading={reservations.isLoading}
          isError={reservations.isError}
          error={reservations.error}
          onRetry={() => reservations.refetch()}
          isFetching={reservations.isFetching}
          isEmpty={grouped.length === 0}
          emptyTitle={expiringOnly ? 'لا توجد حجوزات تنتهي خلال 7 أيام' : 'لا توجد حجوزات'}
          skeletonClassName="h-52"
        >
          {viewMode === 'table' ? <Table>
            <THead cols={['العميل', 'المحصل', 'الحجوزات', 'الأطنان النشطة', 'القيمة', 'أقرب انتهاء', '']} />
            <tbody>
              {grouped.map((rows) => {
                const customer = rows[0].customer;
                const active = rows.filter(activeReservation);
                const tons = active.reduce((sum, row) => {
                  if (row.remainingTons != null) return sum + Number(row.remainingTons);
                  const weight = row.measureUnit?.weightKg;
                  return weight == null ? sum : sum + Number(row.remainingQty ?? row.quantity ?? 0) * Number(weight) / 1000;
                }, 0);
                const values = new Map<string, number>();
                for (const row of active) values.set(row.currencyCode, (values.get(row.currencyCode) ?? 0) + Number(row.remainingQty ?? row.quantity ?? 0) * Number(row.unitPrice ?? 0));
                const nearest = active.map((row) => row.expiresAt).filter(Boolean).sort()[0] ?? null;
                const open = expanded === customer.id;
                return (
                  <FragmentRow key={customer.id}>
                    <TRow onClick={() => setExpanded(open ? null : customer.id)}>
                      <TD><Link href={`/customers/${customer.id}`} onClick={(event) => event.stopPropagation()} className="font-medium text-pine-700 hover:underline dark:text-pine-100">{customer.name}</Link><p className="text-xs text-concrete-500" dir="ltr">{customer.externalCustomerCode}</p></TD>
                      <TD className="text-xs">{customer.assignments[0]?.collector.user.fullName ?? 'غير مسند'}</TD>
                      <TD className="tnum">{rows.length}</TD>
                      <TD className="tnum font-bold">{fmtMoney(tons)}</TD>
                      <TD><div className="space-y-1">{[...values].map(([currency, amount]) => <div key={currency}><Money value={amount} currency={currency} /></div>)}</div></TD>
                      <TD className="text-xs">{nearest ? fmtDate(nearest) : '—'}</TD>
                      <TD>{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</TD>
                    </TRow>
                    {open && (
                      <tr><td colSpan={7} className="bg-concrete-50 p-3 dark:bg-iron-800/60">
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {rows.map((row) => {
                            const tonsForRow = row.remainingTons == null
                              ? row.measureUnit?.weightKg == null ? null : Number(row.remainingQty ?? row.quantity ?? 0) * Number(row.measureUnit.weightKg) / 1000
                              : Number(row.remainingTons);
                            return <div key={row.id} className="rounded-lg border border-concrete-100 bg-white p-3 text-xs dark:border-white/10 dark:bg-iron-800">
                              <div className="flex items-start justify-between gap-2"><span className="font-semibold">حجز إجمالي بالطن</span><Badge tone={row.status === 'cancelled' ? 'debt' : ['completed', 'fulfilled'].includes(row.status) ? 'pine' : 'neutral'}>{STATUS_AR[row.status] ?? row.status}</Badge></div>
                              <p className="mt-2 text-concrete-500">{tonsForRow !== null ? `${fmtMoney(tonsForRow)} طن متبقي` : 'بانتظار التصنيف'}</p>
                              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-concrete-50 p-2 dark:bg-white/5">
                                <div><p className="text-[10px] text-concrete-500">سعر الطن</p><p className="tnum font-bold">{fmtMoney(Number(row.unitPrice ?? 0))} {row.currencyCode}</p></div>
                                <div><p className="text-[10px] text-concrete-500">القيمة المتبقية</p><Money value={Number(row.remainingTons ?? row.remainingQty ?? row.quantity ?? 0) * Number(row.unitPrice ?? 0)} currency={row.currencyCode} /></div>
                              </div>
                              <p className="mt-1 text-concrete-500">{row.warehouse ?? 'مخزن غير محدد'} • {row.documentNumber ?? 'بلا مستند'}</p>
                            </div>;
                          })}
                        </div>
                      </td></tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </Table> : <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredRows.map((row) => {
              const tons = row.remainingTons == null
                ? row.measureUnit?.weightKg == null ? null : Number(row.remainingQty ?? row.quantity ?? 0) * Number(row.measureUnit.weightKg) / 1000
                : Number(row.remainingTons);
              return <div key={row.id} className="rounded-xl border border-concrete-100 bg-white p-4 dark:border-white/10 dark:bg-iron-800">
                <div className="flex items-start justify-between gap-2"><Link href={`/customers/${row.customer.id}`} className="font-semibold text-pine-700 hover:underline dark:text-pine-100">{row.customer.name}</Link><Badge tone={row.status === 'cancelled' ? 'debt' : ['completed', 'fulfilled'].includes(row.status) ? 'pine' : 'neutral'}>{STATUS_AR[row.status] ?? row.status}</Badge></div>
                <p className="mt-2 text-sm font-semibold">حجز إجمالي بالطن</p>
                <p className="mt-1 text-xs text-concrete-500">{tons == null ? 'بانتظار التصنيف' : `${fmtMoney(tons)} طن متبقي`}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-concrete-50 p-2 dark:bg-white/5">
                  <div><p className="text-[10px] text-concrete-500">سعر الطن</p><p className="tnum text-sm font-bold">{fmtMoney(Number(row.unitPrice ?? 0))} {row.currencyCode}</p></div>
                  <div><p className="text-[10px] text-concrete-500">القيمة المتبقية</p><Money value={Number(row.remainingTons ?? row.remainingQty ?? row.quantity ?? 0) * Number(row.unitPrice ?? 0)} currency={row.currencyCode} /></div>
                </div>
                <p className="mt-2 text-xs text-concrete-500">{row.warehouse ?? 'مخزن غير محدد'} • {row.documentNumber ?? 'بلا مستند'} • {row.expiresAt ? fmtDate(row.expiresAt) : 'بلا انتهاء'}</p>
              </div>;
            })}
          </div>}
        </DataState>
      </Card>
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-pine-700 dark:text-pine-100">العودة للوحة التحكم <ChevronLeft className="h-4 w-4" /></Link>
      <CreateReservationDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateReservationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_CREATE_FORM);
  const request = useRef({ payload: '', operationId: '' });
  const [customerSearch, setCustomerSearch] = useState('');
  const customers = useQuery({
    queryKey: ['reservation-customer-search', customerSearch],
    queryFn: () => api<{ items: CustomerSearchItem[] }>(`/reservations/customer-options?search=${encodeURIComponent(customerSearch)}`),
    enabled: open && !form.customerId && customerSearch.trim().length >= 2,
  });
  const create = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        customerId: form.customerId,
        totalTons: Number(form.totalTons),
        unitPrice: Number(form.unitPrice),
        currencyCode: form.currencyCode,
        documentNumber: form.documentNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
        expiresAt: form.expiresAt || undefined,
      });
      if (request.current.payload !== body) request.current = { payload: body, operationId: createRequestId() };
      return api('/reservations', { method: 'POST', body, headers: { 'Idempotency-Key': request.current.operationId } });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservations'] }),
        queryClient.invalidateQueries({ queryKey: ['reservations-summary'] }),
      ]);
      setForm(EMPTY_CREATE_FORM);
      request.current = { payload: '', operationId: '' };
      setCustomerSearch('');
      onClose();
    },
  });
  const valid = !!form.customerId && Number(form.totalTons) > 0 && Number(form.unitPrice) > 0 && ['YER', 'SAR'].includes(form.currencyCode);
  const close = () => {
    if (create.isPending) return;
    setForm(EMPTY_CREATE_FORM);
    request.current = { payload: '', operationId: '' };
    setCustomerSearch('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title="إنشاء حجز بضاعة جديد">
      <div className="space-y-4">
        <Field label="العميل *">
          {form.customerId ? (
            <div className="flex min-h-11 items-center justify-between rounded-lg border border-line bg-surface-2 px-3 text-sm">
              <span className="font-semibold">{form.customerLabel}</span>
              <button type="button" className="text-xs text-debt-600 hover:underline" onClick={() => setForm((value) => ({ ...value, customerId: '', customerLabel: '' }))}>تغيير</button>
            </div>
          ) : (
            <>
              <Input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="ابحث باسم العميل أو رقم الحساب…" />
              {!!customers.data?.items.length && <div className="max-h-40 overflow-y-auto rounded-lg border border-line bg-surface-1">
                {customers.data.items.map((customer) => <button key={customer.id} type="button" className="block w-full px-3 py-2 text-right text-sm hover:bg-surface-2" onClick={() => { setForm((value) => ({ ...value, customerId: customer.id, customerLabel: `${customer.name}${customer.externalCustomerCode ? ` — ${customer.externalCustomerCode}` : ''}` })); setCustomerSearch(''); }}>
                  <span className="font-semibold">{customer.name}</span>{customer.externalCustomerCode && <span className="mr-2 text-xs text-concrete-500" dir="ltr">{customer.externalCustomerCode}</span>}
                </button>)}
              </div>}
            </>
          )}
        </Field>
        <Field label="إجمالي الحجز بالطن *" hint="لا يلزم تحديد الصنف الآن؛ يحدد الصنف عند الفوترة"><Input type="number" min="0.001" step="0.001" value={form.totalTons} onChange={(event) => setForm((value) => ({ ...value, totalTons: event.target.value }))} placeholder="مثال: 6" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="سعر الطن *"><Input type="number" min="0.01" step="0.01" value={form.unitPrice} onChange={(event) => setForm((value) => ({ ...value, unitPrice: event.target.value }))} placeholder="مثال: 385000" /></Field>
          <Field label="العملة *"><Select value={form.currencyCode} onChange={(event) => setForm((value) => ({ ...value, currencyCode: event.target.value }))}><option value="YER">ريال يمني (YER)</option><option value="SAR">ريال سعودي (SAR)</option></Select></Field>
        </div>
        {Number(form.totalTons) > 0 && Number(form.unitPrice) > 0 && <div className="rounded-lg border border-brand/20 bg-brand/5 p-3"><p className="text-xs text-concrete-500">إجمالي قيمة الحجز</p><p className="tnum mt-1 text-lg font-extrabold text-pine-700 dark:text-pine-100">{fmtMoney(Number(form.totalTons) * Number(form.unitPrice))} {form.currencyCode}</p></div>}
        <Field label="رقم المرجع" hint="اختياري"><Input value={form.documentNumber} onChange={(event) => setForm((value) => ({ ...value, documentNumber: event.target.value }))} /></Field>
        <Field label="تاريخ الانتهاء" hint="اختياري"><Input type="date" value={form.expiresAt} onChange={(event) => setForm((value) => ({ ...value, expiresAt: event.target.value }))} /></Field>
        <Field label="ملاحظات" hint="اختياري"><Textarea rows={2} value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} /></Field>
        {create.isError && <p role="alert" className="text-sm text-debt-600">تعذر إنشاء الحجز. تحقق من العميل والكمية ثم أعد المحاولة.</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={close}>إلغاء</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>إنشاء الحجز</Button></div>
      </div>
    </Dialog>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
