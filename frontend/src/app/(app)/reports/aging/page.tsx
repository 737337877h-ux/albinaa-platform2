'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarDays } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Button, Card, Money, Pagination, Select } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { api, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtMoney } from '@/lib/format';

const hasToken = () => typeof window !== 'undefined' && !!tokenStore.access;
const BUCKETS = [
  ['bucket_0_30', '0–30 يوم'], ['bucket_31_60', '31–60 يوم'],
  ['bucket_61_90', '61–90 يوم'], ['bucket_91_120', '91–120 يوم'],
  ['bucket_120_plus', '+120 يوم'], ['undated', 'غير مؤرّخ'],
] as const;
type Bucket = (typeof BUCKETS)[number][0];
type BucketAmounts = Record<Bucket, number>;
interface AgingCustomer {
  customerId: string; customerCode: string; customerName: string; currency: string;
  buckets: BucketAmounts; totalDue: number; provisionAmount: number;
}
interface AgingReport {
  asOf: string; snapshot: boolean; rates: Record<Bucket, number>;
  totals: Record<string, BucketAmounts & { totalDue: number; provisionAmount: number }>;
  customers: AgingCustomer[];
  page: number; limit: number; totalRows: number; totalPages: number;
}

const heat = (bucket: Bucket) => bucket === 'bucket_120_plus'
  ? 'border-debt-600 bg-debt-50 dark:bg-debt-700/20'
  : bucket === 'bucket_91_120' ? 'border-hazard-500 bg-hazard-50 dark:bg-hazard-700/20'
    : bucket === 'undated' ? 'border-concrete-400 bg-concrete-50 dark:bg-white/5'
      : 'border-pine-500 bg-pine-50 dark:bg-pine-900/30';

export default function AgingReportPage() {
  const can = useCan();
  const allowed = can('reports.read');
  const canSnapshot = can('reports.export');
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState('ALL');
  const [accountClass, setAccountClass] = useState<'customer' | 'advance'>('customer');
  const [activeBucket, setActiveBucket] = useState<Bucket | null>(null);
  const [page, setPage] = useState(1);
  const report = useQuery({
    queryKey: ['aging-report', accountClass, currency, activeBucket, page],
    queryFn: () => {
      const params = new URLSearchParams({ accountClass, page: String(page), limit: '50' });
      if (currency !== 'ALL') params.set('currency', currency);
      if (activeBucket) params.set('bucket', activeBucket);
      return api<AgingReport>(`/reports/aging?${params.toString()}`);
    },
    enabled: allowed && hasToken(),
  });
  const snapshot = useMutation({
    mutationFn: () => api('/reports/aging/snapshots', { method: 'POST' }),
    onSuccess: () => { toast('تم إقفال لقطة أعمار الديون بنجاح', 'ok'); queryClient.invalidateQueries({ queryKey: ['aging-report'] }); },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const currencies = [...new Set(['YER', 'SAR', 'USD', ...Object.keys(report.data?.totals ?? {})])];
  const rows = report.data?.customers ?? [];

  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية عرض تقارير أعمار الديون" /></Card>;
  return <div className="space-y-5">
    <PageHeader title="أعمار الديون وتوزيع FIFO" />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-concrete-500">
        <CalendarDays className="h-4 w-4" />
        حتى {report.data?.asOf ?? '—'} {report.data?.snapshot ? '• لقطة مقفلة' : '• مباشر'}
      </div>
      <div className="flex gap-2">
        <Select aria-label="نوع الحساب" value={accountClass} onChange={(event) => { setAccountClass(event.target.value as 'customer' | 'advance'); setCurrency('ALL'); setPage(1); }} className="w-40"><option value="customer">العملاء فقط</option><option value="advance">السلف فقط</option></Select>
        <Select aria-label="العملة" value={currency} onChange={(event) => { setCurrency(event.target.value); setPage(1); }} className="w-40">
          <option value="ALL">كل العملات</option>
          {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
        </Select>
        {canSnapshot && <Button variant="secondary" loading={snapshot.isPending} onClick={() => snapshot.mutate()}><Archive className="h-4 w-4" /> إقفال لقطة اليوم</Button>}
      </div>
    </div>
    <DataState isLoading={report.isLoading} isError={report.isError} error={report.error} onRetry={() => report.refetch()} isFetching={report.isFetching} isEmpty={!report.data?.customers.length} emptyTitle="لا توجد مديونية موجبة" skeletonClassName="h-64">
      <div className="space-y-5">
        {Object.keys(report.data?.totals ?? {}).filter((code) => currency === 'ALL' || code === currency).map((code) => {
          const total = report.data!.totals[code];
          return <Card key={code} className="p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">العملة {code}</h2><div className="text-left"><Money value={total.totalDue} currency={code} /><p className="text-xs text-concrete-500">المخصص: {fmtMoney(total.provisionAmount)} {code}</p></div></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {BUCKETS.map(([bucket, label]) => <button key={bucket} type="button" onClick={() => { setActiveBucket(activeBucket === bucket ? null : bucket); setPage(1); }} className={`rounded-lg border-r-4 p-3 text-right transition hover:-translate-y-0.5 ${heat(bucket)} ${activeBucket === bucket ? 'ring-2 ring-pine-500' : ''}`}>
                <p className="text-xs text-concrete-500">{label}</p><p className="tnum mt-1 text-lg font-extrabold">{fmtMoney(total[bucket])}</p>
              </button>)}
            </div>
          </Card>;
        })}
        <Card className="overflow-hidden">
          <div className="border-b border-concrete-100 px-4 py-3 text-sm font-semibold dark:border-white/10">تفاصيل العملاء {activeBucket ? `• ${BUCKETS.find(([key]) => key === activeBucket)?.[1]}` : ''}</div>
          <Table><THead cols={['العميل', 'العملة', ...BUCKETS.map(([, label]) => label), 'الإجمالي', 'المخصص']} /><tbody>
            {rows.sort((a, b) => b.totalDue - a.totalDue).map((row) => <TRow key={`${row.customerId}-${row.currency}`} hazard={row.buckets.bucket_120_plus > 0}>
              <TD><Link href={`/customers/${row.customerId}`} className="font-semibold text-pine-700 hover:underline dark:text-pine-100">{row.customerName}</Link><p className="text-xs text-concrete-500" dir="ltr">{row.customerCode}</p></TD>
              <TD>{row.currency}</TD>{BUCKETS.map(([bucket]) => <TD key={bucket} className="tnum">{fmtMoney(row.buckets[bucket])}</TD>)}
              <TD><Money value={row.totalDue} currency={row.currency} /></TD><TD className="tnum">{fmtMoney(row.provisionAmount)}</TD>
            </TRow>)}
          </tbody></Table>
          <Pagination page={report.data?.page ?? page} totalPages={report.data?.totalPages ?? 1} onPage={setPage} />
        </Card>
      </div>
    </DataState>
  </div>;
}
