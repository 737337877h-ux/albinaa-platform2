'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronUp, PackageCheck } from 'lucide-react';
import { api, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Card, Money } from '@/components/ui/primitives';
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
  unweightedUnits: { unitName: string; qty: number }[];
  expiringIn7Days: number;
}

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expiringOnly, setExpiringOnly] = useState(false);

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
      <PageHeader title="حجوزات البضاعة" />

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
              <div className="mt-2 space-y-1">{summary.data.totalsByCurrency.map((total) => <Money key={total.currency} value={total.amount} currency={total.currency} />)}</div>
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
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
