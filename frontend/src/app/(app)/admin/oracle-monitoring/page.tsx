'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, Boxes, CheckCircle2, Clock3, Database, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, CardHeader, StatCard } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import Link from 'next/link';

type MirrorKind = 'customers' | 'inventory' | 'movements';
type OverallStatus = 'healthy' | 'degraded' | 'offline' | 'initializing';

interface MirrorRun {
  id: string; sourceSchema: string; status: string; startedAt: string;
  extractedAt: string | null; validatedAt: string | null;
  loadedCounts: Record<string, number> | null;
  validationSummary: Record<string, unknown> | null;
  platformComparison: Record<string, unknown> | null;
  manifestHash: string | null;
}

interface MirrorHeartbeat {
  sourceSchema: string; kind: MirrorKind; lastCheckedAt: string; lastSuccessAt: string | null;
  lastStatus: 'ok' | 'failed'; lastChanged: boolean; lastSyncRunId: string | null;
  ageSeconds: number; healthy: boolean;
}

interface MonitoringSummary {
  mode: 'read_only_mirror'; oracleWriteEnabled: false; scheduleMinutes: number;
  staleAfterMinutes: number; overallStatus: OverallStatus; checkedAt: string;
  heartbeats: MirrorHeartbeat[];
  latest: { customers: MirrorRun | null; inventory: MirrorRun | null; movements: MirrorRun | null };
  history: { customers: MirrorRun[]; inventory: MirrorRun[]; movements: MirrorRun[] };
  operationalCounts: { customers: number; balances: number };
  activePublishedInventory: { runId: string; activatedAt: string } | null;
  automaticPublication: {
    configured: boolean;
    config: { enabled?: boolean; minimumMovementDate?: string; baselineRunId?: string } | null;
    ledger: Array<{ status: string; kind: string; total: number }>;
    quarantineCount: number;
    recentBatches: Array<{ id: string; status: string; startedAt: string; completedAt: string | null; counts: Record<string, unknown> | null }>;
  };
}

const statusCopy: Record<OverallStatus, { title: string; hint: string; tone: 'credit' | 'hazard' | 'debt' | 'neutral' }> = {
  healthy: { title: 'متصل ويعمل', hint: 'آخر فحص تم بنجاح ضمن الوقت المتوقع', tone: 'credit' },
  degraded: { title: 'يحتاج متابعة', hint: 'أحد قسمي المرآة متأخر أو لم يكتمل', tone: 'hazard' },
  offline: { title: 'متأخر عن الموعد', hint: 'لم تصل نبضة نجاح حديثة من المرآة', tone: 'debt' },
  initializing: { title: 'بانتظار أول فحص', hint: 'ستظهر الحالة بعد اكتمال أول دورة', tone: 'neutral' },
};
const kindLabel: Record<MirrorKind, string> = { customers: 'العملاء والأرصدة', inventory: 'الأصناف والمخزون', movements: 'الحركات التفصيلية' };
const runStatus: Record<string, string> = {
  validating: 'للمراجعة', published: 'منشورة', rejected: 'مرفوضة', failed: 'فشلت', extracting: 'قيد الاستخراج',
};

function elapsed(seconds: number) {
  if (seconds < 60) return `منذ ${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  return `منذ ${Math.floor(minutes / 60)} ساعة`;
}
function count(run: MirrorRun | null, key: string) { return Number(run?.loadedCounts?.[key] ?? 0); }

export default function OracleMonitoringPage() {
  const can = useCan();
  const allowed = can('settings.manage');
  const summary = useQuery<MonitoringSummary>({
    queryKey: ['oracle-monitoring-summary'],
    queryFn: () => api('/oracle-monitoring/summary'),
    enabled: allowed,
    refetchInterval: 30_000,
  });
  if (!allowed) return <PermissionNotice message="هذه الشاشة متاحة لمدير النظام فقط." />;

  const status = statusCopy[summary.data?.overallStatus ?? 'initializing'];
  const customerHeartbeat = summary.data?.heartbeats.find((item) => item.kind === 'customers');
  const inventoryHeartbeat = summary.data?.heartbeats.find((item) => item.kind === 'inventory');
  const movementHeartbeat = summary.data?.heartbeats.find((item) => item.kind === 'movements');
  const history = summary.data
    ? [
        ...summary.data.history.customers.map((run) => ({ ...run, kind: 'customers' as const })),
        ...summary.data.history.inventory.map((run) => ({ ...run, kind: 'inventory' as const })),
        ...summary.data.history.movements.map((run) => ({ ...run, kind: 'movements' as const })),
      ].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 10)
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title="مراقبة الربط مع Oracle" action={(
        <Button variant="secondary" loading={summary.isFetching} onClick={() => summary.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden /> تحديث العرض
        </Button>
      )} />
      <DataState isLoading={summary.isLoading} isError={summary.isError} error={summary.error}
        onRetry={() => summary.refetch()} isFetching={summary.isFetching} isEmpty={!summary.data} skeletonClassName="h-64">
        {summary.data && (
          <>
            <Card className="overflow-hidden border-brand/25">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
                    {summary.data.overallStatus === 'healthy' ? <CheckCircle2 className="h-6 w-6" /> : <Activity className="h-6 w-6" />}
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-lg font-bold">{status.title}</h2><Badge tone={status.tone}>{status.title}</Badge></div>
                    <p className="mt-1 text-sm text-ink-mid">{status.hint}</p>
                    <p className="mt-2 text-xs text-ink-mid">
                      الأرصدة والمخزون والحركات التفصيلية كل {summary.data.scheduleMinutes} دقائق، مع نشر آمن للحركات الجديدة المطابقة فقط.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-credit-600/20 bg-credit-50 px-4 py-3 text-credit-700 dark:bg-credit-700/15 dark:text-credit-50">
                  <ShieldCheck className="h-5 w-5" aria-hidden />
                  <div><p className="text-sm font-bold">Oracle للقراءة فقط</p><p className="text-xs">الكتابة والحذف والتعديل غير مفعلة</p></div>
                </div>
              </div>
            </Card>

            <Card className="border-brand/20">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display font-bold">النشر التلقائي الآمن للحركات الجديدة</h2>
                    <Badge tone={summary.data.automaticPublication.config?.enabled ? 'credit' : 'neutral'}>
                      {summary.data.automaticPublication.config?.enabled ? 'مفعّل' : 'متوقف'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-mid">
                    ينشر الحركات الجديدة المطابقة فقط، ويعزل التكرارات والفروقات والعملاء أو الأصناف غير المعروفة.
                  </p>
                  <p className="mt-1 text-xs text-ink-mid">
                    تاريخ البدء: <span dir="ltr" className="tnum">{summary.data.automaticPublication.config?.minimumMovementDate ?? '—'}</span>
                  </p>
                </div>
                <Link href="/admin/oracle-monitoring/exceptions" className="rounded-lg border border-hazard-600/20 bg-hazard-50 px-4 py-3 transition-colors hover:border-hazard-600/40 hover:bg-hazard-100 dark:bg-hazard-700/10">
                  <p className="text-xs text-ink-mid">بانتظار المراجعة</p>
                  <p className="tnum text-xl font-bold">{summary.data.automaticPublication.quarantineCount.toLocaleString('en-US')}</p>
                  <p className="mt-1 text-xs font-semibold text-brand">فتح شاشة المراجعة ←</p>
                </Link>
              </div>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="عملاء المرآة" value={count(summary.data.latest.customers, 'customers')} icon={<Users className="h-4 w-4" />} hint={`التشغيلي: ${summary.data.operationalCounts.customers.toLocaleString('en-US')}`} />
              <StatCard label="أرصدة المرآة" value={count(summary.data.latest.customers, 'customer_balances')} icon={<Database className="h-4 w-4" />} hint={`التشغيلي: ${summary.data.operationalCounts.balances.toLocaleString('en-US')}`} />
              <StatCard label="أصناف المرآة" value={count(summary.data.latest.inventory, 'items')} icon={<Boxes className="h-4 w-4" />} hint="لقطة مستقلة عن المخزون المنشور" />
              <StatCard label="أرصدة المخزون" value={count(summary.data.latest.inventory, 'stock_balances')} icon={<Database className="h-4 w-4" />} hint="مجموع صنف/وحدة/مستودع" />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {(['customers', 'inventory', 'movements'] as MirrorKind[]).map((kind) => {
                const heartbeat = kind === 'customers' ? customerHeartbeat : kind === 'inventory' ? inventoryHeartbeat : movementHeartbeat;
                const latest = summary.data.latest[kind];
                return (
                  <Card key={kind}>
                    <CardHeader title={kindLabel[kind]} action={<Badge tone={heartbeat?.healthy ? 'credit' : 'hazard'}>{heartbeat?.healthy ? 'سليم' : 'بانتظار الفحص'}</Badge>} />
                    <div className="space-y-3 p-4 text-sm">
                      <div className="flex items-center justify-between gap-3"><span className="text-ink-mid">آخر فحص</span><strong>{heartbeat ? elapsed(heartbeat.ageSeconds) : 'لم يصل بعد'}</strong></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-ink-mid">نتيجة الفحص</span><span>{heartbeat?.lastStatus === 'ok' ? 'نجح' : heartbeat ? 'فشل' : '—'}</span></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-ink-mid">هل تغيرت البيانات؟</span><span>{heartbeat ? (heartbeat.lastChanged ? 'نعم، حُمّلت لقطة جديدة' : 'لا، بدون تكرار') : '—'}</span></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-ink-mid">حالة أحدث لقطة</span><Badge tone={latest?.status === 'validating' ? 'hazard' : 'neutral'}>{latest ? (runStatus[latest.status] ?? latest.status) : 'لا توجد'}</Badge></div>
                      {kind === 'movements' && <div className="flex items-center justify-between gap-3"><span className="text-ink-mid">عدد الحركات</span><strong className="tnum">{count(latest, 'customer_movements').toLocaleString('en-US')} عميل / {count(latest, 'inventory_movements').toLocaleString('en-US')} مخزون</strong></div>}
                      <div className="flex items-center justify-between gap-3"><span className="text-ink-mid">وقت أحدث لقطة</span><span dir="ltr" className="tnum">{latest ? fmtDateTime(latest.startedAt) : '—'}</span></div>
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardHeader title="آخر دفعات المرآة" action={<span className="flex items-center gap-1 text-xs text-ink-mid"><Clock3 className="h-3.5 w-3.5" /> أحدث 10 دفعات</span>} />
              <Table><THead cols={['القسم', 'وقت اللقطة', 'الحالة', 'السجلات الرئيسية', 'رقم الدفعة']} /><tbody>
                {history.map((run) => <TRow key={`${run.kind}-${run.id}`}>
                  <TD className="font-semibold">{kindLabel[run.kind]}</TD>
                  <TD><span dir="ltr" className="tnum">{fmtDateTime(run.startedAt)}</span></TD>
                  <TD><Badge tone={run.status === 'validating' ? 'hazard' : run.status === 'published' ? 'credit' : 'neutral'}>{runStatus[run.status] ?? run.status}</Badge></TD>
                  <TD className="tnum">{run.kind === 'customers' ? count(run, 'customers') : run.kind === 'inventory' ? count(run, 'items') : count(run, 'customer_movements') + count(run, 'inventory_movements')}</TD>
                  <TD><span dir="ltr" className="tnum text-xs">{run.id.slice(0, 8)}</span></TD>
                </TRow>)}
              </tbody></Table>
            </Card>
          </>
        )}
      </DataState>
    </div>
  );
}
