'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, Clock3, RefreshCw, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, StatCard } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';

type Device = {
  id: string; deviceId: string; deviceName: string | null; platform: string; appVersion: string | null;
  lastConnectedAt: string; lastSyncedAt: string | null; lastResponseMs: number | null; online: boolean;
  user: { id: string; fullName: string; username: string; isActive: boolean };
};
type Response = { serverTime: string; items: Device[] };

export default function DeviceMonitoringPage() {
  const can = useCan();
  const allowed = can('settings.manage');
  const devices = useQuery<Response>({ queryKey: ['device-monitoring'], queryFn: () => api('/mobile/devices'), enabled: allowed, refetchInterval: 30_000 });
  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية مراقبة الأجهزة." /></Card>;
  const online = devices.data?.items.filter((item) => item.online).length ?? 0;
  const responseRows = devices.data?.items.filter((item) => item.lastResponseMs !== null) ?? [];
  const averageResponse = responseRows.length ? Math.round(responseRows.reduce((sum, item) => sum + Number(item.lastResponseMs), 0) / responseRows.length) : 0;
  return <div className="space-y-5">
    <PageHeader title="مراقبة الأجهزة والاتصال" action={<Button variant="secondary" onClick={() => devices.refetch()} loading={devices.isFetching}><RefreshCw className="h-4 w-4" />تحديث</Button>} />
    <div className="grid gap-3 sm:grid-cols-3"><StatCard label="الأجهزة المسجلة" value={devices.data?.items.length ?? 0} icon={<Smartphone className="h-4 w-4 text-brand" />} /><StatCard label="متصلة الآن" value={online} icon={<Activity className="h-4 w-4 text-credit-700" />} hint="آخر اتصال خلال 5 دقائق" /><StatCard label="متوسط الاستجابة" value={`${averageResponse} ms`} icon={<Clock3 className="h-4 w-4 text-gold" />} /></div>
    <Card className="overflow-hidden"><DataState isLoading={devices.isLoading} isError={devices.isError} error={devices.error} onRetry={() => devices.refetch()} isFetching={devices.isFetching} isEmpty={(devices.data?.items.length ?? 0) === 0} emptyTitle="لم يتصل أي جهاز بعد"><Table><THead cols={['الحالة', 'المستخدم', 'الجهاز', 'النظام/الإصدار', 'آخر اتصال', 'آخر مزامنة', 'الاستجابة']} /><tbody>{(devices.data?.items ?? []).map((item) => <TRow key={item.id}><TD><Badge tone={item.online ? 'pine' : 'neutral'}>{item.online ? 'متصل' : 'غير متصل'}</Badge></TD><TD><p className="font-semibold">{item.user.fullName}</p><p className="text-xs text-ink-mid">{item.user.username}</p></TD><TD>{item.deviceName ?? item.deviceId}</TD><TD><span dir="ltr">{item.platform} · v{item.appVersion ?? '—'}</span></TD><TD>{new Date(item.lastConnectedAt).toLocaleString('ar-YE')}</TD><TD>{item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString('ar-YE') : 'لم تتم'}</TD><TD className="tnum">{item.lastResponseMs == null ? '—' : `${item.lastResponseMs} ms`}</TD></TRow>)}</tbody></Table></DataState></Card>
  </div>;
}
