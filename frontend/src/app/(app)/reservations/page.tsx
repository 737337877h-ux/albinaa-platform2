'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronUp, PackageCheck, Plus } from 'lucide-react';
import { api, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Field, Input, Money, Select, Textarea } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { Table, TD, THead, TRow } from '@/components/ui/table';

const hasToken = () => typeof window !== 'undefined' && !!tokenStore.access;

interface UnitInfo { id: string; code: string; nameAr: string; weightKg: string | number | null }
interface Reservation {
  id: string;
  itemName: string | null;
  itemType: string | null;
  quantity: string | number | null;
  remainingQty: string | number | null;
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
interface CustomerSearchItem { id: string; name: string; externalCustomerCode: string | null }

const EMPTY_CREATE_FORM = {
  customerId: '', customerLabel: '', itemName: '', itemType: '', quantity: '', unitId: '',
  unitPrice: '', currencyCode: 'YER', warehouse: '', documentNumber: '', notes: '', expiresAt: '', overrideReason: '',
};

const STATUS_AR: Record<string, string> = {
  open: 'نشط', partial: 'مسلّم جزئيًا', completed: 'مسلّم بالكامل', cancelled: 'ملغى', expired: 'منتهي',
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

  const grouped = useMemo(() => {
    const now = Date.now();
    const sevenDays = now + 7 * 86_400_000;
    const visible = (reservations.data ?? []).filter((row) => {
      if (!expiringOnly) return true;
      if (!activeReservation(row) || !row.expiresAt) return false;
      const expiry = new Date(row.expiresAt).getTime();
      return expiry >= now && expiry <= sevenDays;
    });
    const map = new Map<string, Reservation[]>();
    for (const row of visible) map.set(row.customer.id, [...(map.get(row.customer.id) ?? []), row]);
    return [...map.values()];
  }, [reservations.data, expiringOnly]);

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
          <Table>
            <THead cols={['العميل', 'المحصل', 'الحجوزات', 'الأطنان النشطة', 'القيمة', 'أقرب انتهاء', '']} />
            <tbody>
              {grouped.map((rows) => {
                const customer = rows[0].customer;
                const active = rows.filter(activeReservation);
                const tons = active.reduce((sum, row) => {
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
                            const tonsForRow = row.measureUnit?.weightKg == null ? null : Number(row.remainingQty ?? row.quantity ?? 0) * Number(row.measureUnit.weightKg) / 1000;
                            return <div key={row.id} className="rounded-lg border border-concrete-100 bg-white p-3 text-xs dark:border-white/10 dark:bg-iron-800">
                              <div className="flex items-start justify-between gap-2"><span className="font-semibold">{row.itemName ?? 'صنف غير مسمى'}</span><Badge tone={row.status === 'cancelled' ? 'debt' : row.status === 'completed' ? 'pine' : 'neutral'}>{STATUS_AR[row.status] ?? row.status}</Badge></div>
                              <p className="mt-2 text-concrete-500">{fmtMoney(Number(row.remainingQty ?? row.quantity ?? 0))} {row.measureUnit?.nameAr ?? 'بانتظار التصنيف'}{tonsForRow !== null ? ` • ${fmtMoney(tonsForRow)} طن` : ''}</p>
                              <p className="mt-1"><Money value={Number(row.remainingQty ?? row.quantity ?? 0) * Number(row.unitPrice ?? 0)} currency={row.currencyCode} /></p>
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
          </Table>
        </DataState>
      </Card>
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-pine-700 dark:text-pine-100">العودة للوحة التحكم <ChevronLeft className="h-4 w-4" /></Link>
      <CreateReservationDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateReservationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const can = useCan();
  const [form, setForm] = useState(EMPTY_CREATE_FORM);
  const [customerSearch, setCustomerSearch] = useState('');
  const customers = useQuery({
    queryKey: ['reservation-customer-search', customerSearch],
    queryFn: () => api<{ items: CustomerSearchItem[] }>(`/customers?search=${encodeURIComponent(customerSearch)}&limit=10`),
    enabled: open && !form.customerId && customerSearch.trim().length >= 2,
  });
  const units = useQuery({
    queryKey: ['reservation-units'],
    queryFn: () => api<UnitInfo[]>('/reservations/units'),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const create = useMutation({
    mutationFn: () => api('/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerId: form.customerId,
        itemName: form.itemName.trim(),
        itemType: form.itemType.trim() || undefined,
        quantity: Number(form.quantity),
        unitId: form.unitId,
        unitPrice: Number(form.unitPrice),
        currencyCode: form.currencyCode,
        warehouse: form.warehouse.trim() || undefined,
        documentNumber: form.documentNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
        expiresAt: form.expiresAt || undefined,
        overrideReason: form.overrideReason.trim() || undefined,
      }),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservations'] }),
        queryClient.invalidateQueries({ queryKey: ['reservations-summary'] }),
      ]);
      setForm(EMPTY_CREATE_FORM);
      setCustomerSearch('');
      onClose();
    },
  });
  const valid = !!form.customerId && !!form.itemName.trim() && Number(form.quantity) > 0
    && !!form.unitId && Number(form.unitPrice) > 0 && !!form.currencyCode;
  const close = () => {
    if (create.isPending) return;
    setForm(EMPTY_CREATE_FORM);
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
        <Field label="الصنف *"><Input value={form.itemName} onChange={(event) => setForm((value) => ({ ...value, itemName: event.target.value }))} placeholder="مثال: حديد تسليح 12 ملم" /></Field>
        <Field label="نوع الصنف" hint="اختياري"><Input value={form.itemType} onChange={(event) => setForm((value) => ({ ...value, itemType: event.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الكمية *"><Input type="number" min="0" step="any" value={form.quantity} onChange={(event) => setForm((value) => ({ ...value, quantity: event.target.value }))} /></Field>
          <Field label="الوحدة *"><Select value={form.unitId} onChange={(event) => setForm((value) => ({ ...value, unitId: event.target.value }))}><option value="">اختر الوحدة</option>{(units.data ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.nameAr}{unit.weightKg == null ? '' : ` — ${unit.weightKg} كجم`}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="سعر الوحدة *"><Input type="number" min="0" step="any" value={form.unitPrice} onChange={(event) => setForm((value) => ({ ...value, unitPrice: event.target.value }))} /></Field>
          <Field label="العملة *"><Select value={form.currencyCode} onChange={(event) => setForm((value) => ({ ...value, currencyCode: event.target.value }))}><option value="YER">YER</option><option value="SAR">SAR</option><option value="USD">USD</option></Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المخزن" hint="اختياري"><Input value={form.warehouse} onChange={(event) => setForm((value) => ({ ...value, warehouse: event.target.value }))} /></Field>
          <Field label="رقم المستند" hint="اختياري"><Input value={form.documentNumber} onChange={(event) => setForm((value) => ({ ...value, documentNumber: event.target.value }))} /></Field>
        </div>
        <Field label="تاريخ الانتهاء" hint="اختياري"><Input type="date" value={form.expiresAt} onChange={(event) => setForm((value) => ({ ...value, expiresAt: event.target.value }))} /></Field>
        <Field label="ملاحظات" hint="اختياري"><Textarea rows={2} value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} /></Field>
        {can('credit.override') && <Field label="سبب تجاوز سقف الائتمان" hint="يُستخدم فقط عند الحاجة"><Textarea rows={2} value={form.overrideReason} onChange={(event) => setForm((value) => ({ ...value, overrideReason: event.target.value }))} /></Field>}
        {create.isError && <p role="alert" className="text-sm text-debt-600">تعذر إنشاء الحجز. تحقق من البيانات وسقف الائتمان ثم أعد المحاولة.</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={close}>إلغاء</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>إنشاء الحجز</Button></div>
      </div>
    </Dialog>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
