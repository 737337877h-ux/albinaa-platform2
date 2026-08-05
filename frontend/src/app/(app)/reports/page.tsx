'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Printer, TrendingUp, Users } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Button, Card, Money, Select } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { api, downloadApiFile, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';

interface CurrencySummary { currency: string; debtTotal: number; debtorCount: number; reservationTotal: number; reservationCount: number; aging: Aging | null; kpi: { dso: number | null; cei: number | null; averageDebtAge: number | null } | null }
interface Aging { bucket_0_30: number; bucket_31_60: number; bucket_61_90: number; bucket_91_120: number; bucket_120_plus: number; undated: number; totalDue: number; provisionAmount: number }
interface ReportSummary {
  generatedAt: string; currenciesSeparated: boolean; byCurrency: CurrencySummary[];
  topDebtors: { rank: number; currency: string; customerId: string; customerCode: string; customerName: string; balance: number }[];
  activeReservations: { id: string; customerName: string; currency: string; itemName: string; totalAmount: number; status: string; expiresAt: string | null }[];
  collectorPerformance: { collectorId: string; collectorName: string; currency: string; dailyAmount: number; monthlyAmount: number; target: number | null; attainment: number | null; promiseRate: number | null }[];
}

const hasToken = () => typeof window !== 'undefined' && !!tokenStore.access;

export default function ReportsPage() {
  const can = useCan(); const allowed = can('reports.read'); const canExport = can('reports.export');
  const [accountClass, setAccountClass] = useState<'customer' | 'advance'>('customer');
  const [currency, setCurrency] = useState(''); const [downloading, setDownloading] = useState(false);
  const report = useQuery({ queryKey: ['reports-summary', accountClass], queryFn: () => api<ReportSummary>(`/reports/summary?accountClass=${accountClass}`), enabled: allowed && hasToken() });
  const currencies = report.data?.byCurrency.map((row) => row.currency) ?? [];
  const selected = currency || currencies[0] || '';
  const summary = report.data?.byCurrency.find((row) => row.currency === selected);
  const debtors = useMemo(() => report.data?.topDebtors.filter((row) => row.currency === selected) ?? [], [report.data, selected]);
  const reservations = report.data?.activeReservations.filter((row) => row.currency === selected) ?? [];
  const collectors = report.data?.collectorPerformance.filter((row) => row.currency === selected) ?? [];

  async function exportExcel() {
    setDownloading(true);
    try { await downloadApiFile(`/reports/summary.xlsx?accountClass=${accountClass}`, `albinaa-${accountClass}-report-${new Date().toISOString().slice(0, 10)}.xlsx`); toast('تم تنزيل تقرير Excel المنسق', 'ok'); }
    catch (error) { toast(error instanceof Error ? error.message : 'تعذّر تنزيل التقرير', 'err'); }
    finally { setDownloading(false); }
  }
  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية عرض التقارير" /></Card>;
  return <div className="report-print space-y-5">
    <PageHeader title="التقرير الإداري الشامل" action={<div className="flex gap-2 print:hidden">{canExport && <Button variant="secondary" loading={downloading} onClick={exportExcel}><Download className="h-4 w-4" /> Excel</Button>}<Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button></div>} />
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-concrete-500">ملخص {accountClass === 'advance' ? 'السلف على الغير' : 'مديونية العملاء'} • كل عملة مستقلة • {report.data ? fmtDate(report.data.generatedAt) : '—'}</p><div className="flex gap-2"><Select aria-label="نوع الحساب" className="w-44" value={accountClass} onChange={(event) => { setAccountClass(event.target.value as 'customer' | 'advance'); setCurrency(''); }}><option value="customer">العملاء فقط</option><option value="advance">السلف فقط</option></Select><Select aria-label="العملة" className="w-44" value={selected} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</Select></div></div>
    <DataState isLoading={report.isLoading} isError={report.isError} error={report.error} onRetry={() => report.refetch()} isFetching={report.isFetching} isEmpty={!currencies.length} emptyTitle="لا توجد بيانات مالية للتقرير" skeletonClassName="h-72">
      {summary && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric title="إجمالي المديونية" value={<Money value={summary.debtTotal} currency={selected} />} hint={`${summary.debtorCount} عميل مدين`} icon={<TrendingUp className="h-4 w-4 text-debt-600" />} />
          <Metric title="الحجوزات النشطة" value={<Money value={summary.reservationTotal} currency={selected} />} hint={`${summary.reservationCount} حجز`} icon={<FileText className="h-4 w-4" />} />
          <Metric title="أيام التحصيل DSO" value={summary.kpi?.dso == null ? 'غير متاح' : fmtMoney(summary.kpi.dso)} hint={`CEI: ${summary.kpi?.cei == null ? 'بانتظار الإقفال' : `${fmtMoney(summary.kpi.cei)}%`}`} icon={<Users className="h-4 w-4" />} />
          <Metric title="متوسط عمر الدين" value={summary.kpi?.averageDebtAge == null ? 'غير متاح' : `${fmtMoney(summary.kpi.averageDebtAge)} يوم`} hint={`مخصص متوقع: ${fmtMoney(summary.aging?.provisionAmount ?? 0)} ${selected}`} icon={<TrendingUp className="h-4 w-4" />} />
        </div>
        <Card className="overflow-hidden"><div className="border-b border-concrete-100 px-4 py-3 font-semibold dark:border-white/10">أعلى المدينين — أولوية التواصل</div><Table><THead cols={['#', 'كود العميل', 'العميل', 'الرصيد', 'الإجراء']} /><tbody>{debtors.map((row) => <TRow key={row.customerId}><TD>{row.rank}</TD><TD>{row.customerCode}</TD><TD className="font-semibold">{row.customerName}</TD><TD><Money value={row.balance} currency={selected} /></TD><TD><Link className="text-pine-700 hover:underline print:hidden" href={`/customers/${row.customerId}`}>فتح ملف العميل</Link></TD></TRow>)}</tbody></Table></Card>
        <Card className="overflow-hidden"><div className="border-b border-concrete-100 px-4 py-3 font-semibold dark:border-white/10">أعمار الديون</div><Table><THead cols={['0–30 يوم', '31–60', '61–90', '91–120', '+120', 'غير مؤرخ', 'الإجمالي']} /><tbody><TRow><TD><Money value={summary.aging?.bucket_0_30 ?? 0} currency={selected} /></TD><TD><Money value={summary.aging?.bucket_31_60 ?? 0} currency={selected} /></TD><TD><Money value={summary.aging?.bucket_61_90 ?? 0} currency={selected} /></TD><TD><Money value={summary.aging?.bucket_91_120 ?? 0} currency={selected} /></TD><TD><Money value={summary.aging?.bucket_120_plus ?? 0} currency={selected} /></TD><TD><Money value={summary.aging?.undated ?? 0} currency={selected} /></TD><TD><Money value={summary.aging?.totalDue ?? 0} currency={selected} /></TD></TRow></tbody></Table></Card>
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden"><div className="border-b border-concrete-100 px-4 py-3 font-semibold dark:border-white/10">أداء المحصلين</div><Table><THead cols={['المحصل', 'اليوم', 'الشهر', 'الهدف', 'الإنجاز']} /><tbody>{collectors.map((row) => <TRow key={row.collectorId}><TD>{row.collectorName}</TD><TD><Money value={row.dailyAmount} currency={selected} /></TD><TD><Money value={row.monthlyAmount} currency={selected} /></TD><TD>{row.target == null ? '—' : <Money value={row.target} currency={selected} />}</TD><TD>{row.attainment == null ? '—' : `${fmtMoney(row.attainment)}%`}</TD></TRow>)}</tbody></Table>{!collectors.length && <p className="p-5 text-center text-sm text-concrete-500">لا توجد تحصيلات للمحصلين بهذه العملة</p>}</Card>
          <Card className="overflow-hidden"><div className="border-b border-concrete-100 px-4 py-3 font-semibold dark:border-white/10">الحجوزات النشطة</div><Table><THead cols={['العميل', 'الصنف', 'القيمة', 'الانتهاء']} /><tbody>{reservations.map((row) => <TRow key={row.id}><TD>{row.customerName}</TD><TD>{row.itemName}</TD><TD><Money value={row.totalAmount} currency={selected} /></TD><TD>{row.expiresAt ? fmtDate(row.expiresAt) : '—'}</TD></TRow>)}</tbody></Table>{!reservations.length && <p className="p-5 text-center text-sm text-concrete-500">لا توجد حجوزات نشطة بهذه العملة</p>}</Card>
        </div>
      </>}
    </DataState>
  </div>;
}

function Metric({ title, value, hint, icon }: { title: string; value: React.ReactNode; hint: string; icon: React.ReactNode }) {
  return <Card className="p-4"><div className="flex items-center justify-between text-xs text-concrete-500"><span>{title}</span>{icon}</div><div className="tnum mt-2 text-2xl font-extrabold">{value}</div><p className="mt-1 text-xs text-concrete-500">{hint}</p></Card>;
}
