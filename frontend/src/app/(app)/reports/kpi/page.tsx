'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Medal, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { Button, Card, Field, Input, Money, Select } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { api, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtMoney } from '@/lib/format';

const hasToken = () => typeof window !== 'undefined' && !!tokenStore.access;
interface TrendRow { month: string; currency: string; opening: number; sales: number; closing: number; dso: number | null; cei: number | null; averageDebtAge: number | null; undatedDebt: number; closedSnapshot: boolean; liveEstimate?: boolean }
interface CollectorRow { collectorId: string; collectorName: string; currency: string; dailyAmount: number; monthlyAmount: number; previousMonthAmount: number; target: number | null; attainment: number | null; promisesFulfilled: number; promisesTotal: number; promiseRate: number | null }
interface LeaderRow extends CollectorRow { score: number; rank: number; previousRank: number; rankChange: number }
interface KpiResponse { generatedAt: string; latestByCurrency: Record<string, TrendRow & { debtAgeDeterioration: number | null }>; trend: TrendRow[]; collectors: CollectorRow[]; leaderboard: LeaderRow[]; dataQuality: { monthsWithoutAgingSnapshot: string[] } }

export default function KpiPage() {
  const can = useCan(); const allowed = can('reports.read'); const canSetTarget = can('reports.export');
  const qc = useQueryClient();
  const [accountClass, setAccountClass] = useState<'customer' | 'advance'>('customer');
  const [currency, setCurrency] = useState('');
  const [targetRow, setTargetRow] = useState<CollectorRow | null>(null);
  const [targetAmount, setTargetAmount] = useState('');
  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
  const report = useQuery({ queryKey: ['reports-kpi', accountClass], queryFn: () => api<KpiResponse>(`/reports/kpi?accountClass=${accountClass}`), enabled: allowed && hasToken() });
  const currencies = Object.keys(report.data?.latestByCurrency ?? {});
  const selected = currency || currencies[0] || '';
  const trend = useMemo(() => (report.data?.trend ?? []).filter((row) => row.currency === selected), [report.data, selected]);
  const leaderboard = (report.data?.leaderboard ?? []).filter((row) => row.currency === selected);
  const targetMut = useMutation({
    mutationFn: () => api(`/reports/kpi/targets/${targetRow!.collectorId}/${targetRow!.currency}`, { method: 'PATCH', body: JSON.stringify({ month: currentMonth, targetAmount: Number(targetAmount) }) }),
    onSuccess: () => { toast('تم اعتماد هدف التحصيل الشهري', 'ok'); setTargetRow(null); qc.invalidateQueries({ queryKey: ['reports-kpi'] }); },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية عرض مؤشرات التحصيل" /></Card>;
  const latest = report.data?.latestByCurrency[selected];
  return <div className="space-y-5">
    <PageHeader title="مؤشرات أداء التحصيل" />
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-concrete-500">اتجاه 12 شهرًا • {accountClass === 'advance' ? 'السلف فقط' : 'العملاء فقط'} • العملات منفصلة</p><div className="flex gap-2"><Select aria-label="نوع الحساب" className="w-40" value={accountClass} onChange={(event) => { setAccountClass(event.target.value as 'customer' | 'advance'); setCurrency(''); }}><option value="customer">العملاء فقط</option><option value="advance">السلف فقط</option></Select><Select aria-label="العملة" className="w-40" value={selected} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</Select></div></div>
    <DataState isLoading={report.isLoading} isError={report.isError} error={report.error} onRetry={() => report.refetch()} isFetching={report.isFetching} isEmpty={!currencies.length} emptyTitle="لا توجد بيانات مؤشرات بعد" skeletonClassName="h-64">
      {latest && <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric title="DSO — أيام التحصيل" value={latest.dso === null ? 'غير متاح' : fmtMoney(latest.dso)} hint="كلما انخفض كان أفضل" icon={<Activity className="h-4 w-4" />} />
          <Metric title="CEI — كفاءة التحصيل" value={latest.cei === null ? 'غير متاح' : `${fmtMoney(latest.cei)}%`} hint={latest.closedSnapshot ? 'مبني على لقطة شهرية' : latest.liveEstimate ? 'تقدير مباشر دون إقفال' : 'لا توجد بيانات كافية'} icon={<Target className="h-4 w-4" />} />
          <Metric title="متوسط عمر الدين" value={latest.averageDebtAge === null ? 'غير متاح' : `${fmtMoney(latest.averageDebtAge)} يوم`} hint={`غير مؤرّخ: ${fmtMoney(latest.undatedDebt)} ${selected}`} icon={latest.debtAgeDeterioration !== null && latest.debtAgeDeterioration > 0 ? <TrendingUp className="h-4 w-4 text-debt-600" /> : <TrendingDown className="h-4 w-4 text-credit-600" />} />
          <Metric title="الرصيد الختامي" value={fmtMoney(latest.closing)} hint={`مبيعات آجلة: ${fmtMoney(latest.sales)} ${selected}`} icon={<Money value={latest.closing} currency={selected} />} />
        </div>
        <Card className="p-4"><h2 className="mb-4 text-sm font-semibold">اتجاه DSO وCEI خلال 12 شهرًا</h2><div className="grid min-w-[760px] grid-cols-12 gap-2 overflow-x-auto">{trend.map((row) => <div key={row.month} className="text-center"><div className="flex h-36 items-end justify-center gap-1"><div title={`DSO ${row.dso ?? '—'}`} className="w-4 rounded-t bg-pine-600" style={{ height: `${Math.min(100, row.dso ?? 0)}%` }} /><div title={`CEI ${row.cei ?? '—'}`} className="w-4 rounded-t bg-sky-500" style={{ height: `${Math.min(100, Math.max(0, row.cei ?? 0))}%` }} /></div><p className="mt-2 text-[10px] text-concrete-500">{row.month}</p><p className="tnum text-[10px]">{row.dso === null ? '—' : fmtMoney(row.dso)} / {row.cei === null ? '—' : fmtMoney(row.cei)}</p></div>)}</div><div className="mt-3 flex gap-4 text-xs text-concrete-500"><span>■ DSO</span><span className="text-sky-600">■ CEI</span></div></Card>
        <Card className="overflow-hidden"><div className="border-b border-concrete-100 px-4 py-3 text-sm font-semibold dark:border-white/10">ترتيب المحصلين — {selected}</div><Table><THead cols={['الترتيب', 'المحصل', 'اليوم', 'الشهر', 'الهدف', 'الإنجاز', 'الوفاء بالوعود', 'مقارنة الشهر السابق', '']} /><tbody>{leaderboard.map((row) => <TRow key={row.collectorId}><TD><span className="inline-flex items-center gap-1 font-bold"><Medal className="h-4 w-4 text-hazard-500" />#{row.rank}</span></TD><TD className="font-semibold">{row.collectorName}</TD><TD><Money value={row.dailyAmount} currency={selected} /></TD><TD><Money value={row.monthlyAmount} currency={selected} /></TD><TD>{row.target === null ? 'غير محدد' : <Money value={row.target} currency={selected} />}</TD><TD className="tnum">{row.attainment === null ? '—' : `${fmtMoney(row.attainment)}%`}</TD><TD className="tnum">{row.promisesFulfilled}/{row.promisesTotal} ({row.promiseRate === null ? '—' : `${fmtMoney(row.promiseRate)}%`})</TD><TD className={row.rankChange > 0 ? 'text-credit-600' : row.rankChange < 0 ? 'text-debt-600' : ''}>{row.rankChange > 0 ? `▲ ${row.rankChange}` : row.rankChange < 0 ? `▼ ${Math.abs(row.rankChange)}` : '—'}</TD><TD>{canSetTarget && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setTargetRow(row); setTargetAmount(row.target === null ? '' : String(row.target)); }}>تحديد الهدف</Button>}</TD></TRow>)}</tbody></Table></Card>
        {report.data!.dataQuality.monthsWithoutAgingSnapshot.length > 0 && <Card className="border-r-4 border-r-hazard-500 p-4 text-sm"><p className="font-semibold">جودة المؤشرات</p><p className="mt-1 text-concrete-400">الشهر الحالي يُحسب مباشرة دون إقفال. الأشهر التاريخية التي لا تحتوي لقطة محفوظة تبقى غير متاحة منعًا لعرض أرقام غير موثوقة.</p></Card>}
      </div>}
    </DataState>
    <Dialog open={!!targetRow} onClose={() => setTargetRow(null)} title="اعتماد هدف التحصيل الشهري">{targetRow && <div className="space-y-4"><p className="text-sm text-concrete-500">{targetRow.collectorName} • {targetRow.currency} • {currentMonth.slice(0, 7)}</p><Field label="الهدف الشهري"><Input type="number" min="0" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} /></Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setTargetRow(null)}>إلغاء</Button><Button loading={targetMut.isPending} disabled={targetAmount === '' || Number(targetAmount) < 0} onClick={() => targetMut.mutate()}>اعتماد الهدف</Button></div></div>}</Dialog>
  </div>;
}

function Metric({ title, value, hint, icon }: { title: string; value: string; hint: string; icon: React.ReactNode }) {
  return <Card className="p-4"><div className="flex items-center justify-between text-xs text-concrete-500"><span>{title}</span>{icon}</div><p className="tnum mt-2 text-2xl font-extrabold">{value}</p><p className="mt-1 text-xs text-concrete-500">{hint}</p></Card>;
}
