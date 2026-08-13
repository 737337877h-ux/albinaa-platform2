'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Megaphone, Send } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Field, Input, Money, Select } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { DEFAULT_MESSAGE_TEMPLATES, parseMessageTemplates } from '@/lib/messaging';

interface Setting { key: string; value: unknown }
interface Preview {
  totalCount: number; readyCount: number; skippedCount: number;
  totalByCurrency: Record<string, number>;
  sample: { customerId: string; customerName: string; customerCode: string | null; balance: number; currency: string; destination: string | null; message: string }[];
}
interface Campaign {
  id: string; name: string; channel: string; agingBucket: string; currencyCode: string | null;
  status: string; provider: string; totalCount: number; readyCount: number; skippedCount: number; createdAt: string;
}
interface CampaignDetail extends Campaign {
  dispatches: { id: string; destination: string | null; renderedMessage: string; status: string; manualUrl: string | null; customer: { name: string; externalCustomerCode: string } }[];
}

const BUCKETS = [
  ['bucket_31_60', 'من 31 إلى 60 يومًا'], ['bucket_61_90', 'من 61 إلى 90 يومًا'],
  ['bucket_91_120', 'من 91 إلى 120 يومًا'], ['bucket_120_plus', 'أكثر من 120 يومًا'],
] as const;

export default function CampaignsPage() {
  const can = useCan();
  const allowed = can('tasks.manage');
  const queryClient = useQueryClient();
  const [name, setName] = useState('حملة تحصيل المتأخرات');
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [templateId, setTemplateId] = useState('firm-reminder');
  const [bucket, setBucket] = useState('bucket_120_plus');
  const [currency, setCurrency] = useState('YER');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);

  const settings = useQuery<Setting[]>({ queryKey: ['settings-for-campaigns'], queryFn: () => api('/settings'), enabled: allowed });
  const templates = useMemo(() => {
    const configured = settings.data?.find((item) => item.key === 'communication.templates')?.value;
    return parseMessageTemplates(configured).filter((item) => item.active && (item.channel === channel || item.channel === 'both'));
  }, [settings.data, channel]);
  const selectedTemplate = templates.find((item) => item.id === templateId) ?? templates[0] ?? DEFAULT_MESSAGE_TEMPLATES[0];
  const payload = () => ({ name, channel, templateId: selectedTemplate.id, messageBody: selectedTemplate.body, agingBucket: bucket, currency });

  const campaigns = useQuery<Campaign[]>({ queryKey: ['message-campaigns'], queryFn: () => api('/messaging/campaigns'), enabled: allowed });
  const detail = useQuery<CampaignDetail>({
    queryKey: ['message-campaign-detail', selectedCampaign],
    queryFn: () => api(`/messaging/campaigns/${selectedCampaign}`), enabled: !!selectedCampaign,
  });
  const previewMutation = useMutation({
    mutationFn: () => api<Preview>('/messaging/campaigns/preview', { method: 'POST', body: JSON.stringify(payload()) }),
    onSuccess: setPreview, onError: (error: Error) => toast(error.message, 'err'),
  });
  const createMutation = useMutation({
    mutationFn: () => api<Campaign>('/messaging/campaigns', { method: 'POST', body: JSON.stringify(payload()) }),
    onSuccess: async (campaign) => {
      toast('تم تجهيز الحملة وسجل الإرسال دون إرسال خارجي تلقائي', 'ok');
      setSelectedCampaign(campaign.id); setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ['message-campaigns'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const openManual = async (campaignId: string, dispatch: CampaignDetail['dispatches'][number]) => {
    if (!dispatch.manualUrl) return;
    window.open(dispatch.manualUrl, '_blank', 'noopener,noreferrer');
    await api(`/messaging/campaigns/${campaignId}/dispatches/${dispatch.id}/opened`, { method: 'POST' });
    queryClient.invalidateQueries({ queryKey: ['message-campaign-detail', campaignId] });
  };

  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية إدارة حملات التحصيل" /></Card>;
  return <div className="space-y-5">
    <PageHeader title="حملات التحصيل والتصعيد" />
    <Card className="p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Field label="اسم الحملة"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="القناة"><Select value={channel} onChange={(e) => { setChannel(e.target.value as 'whatsapp' | 'sms'); setPreview(null); }}><option value="whatsapp">واتساب</option><option value="sms">رسالة نصية</option></Select></Field>
        <Field label="شريحة عمر الدين"><Select value={bucket} onChange={(e) => { setBucket(e.target.value); setPreview(null); }}>{BUCKETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <Field label="العملة"><Select value={currency} onChange={(e) => { setCurrency(e.target.value); setPreview(null); }}><option>YER</option><option>SAR</option><option>USD</option></Select></Field>
        <Field label="قالب الرسالة"><Select value={selectedTemplate.id} onChange={(e) => { setTemplateId(e.target.value); setPreview(null); }}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</Select></Field>
      </div>
      <div className="mt-3 rounded-lg bg-concrete-50 p-3 text-sm dark:bg-white/5">{selectedTemplate.body}</div>
      <div className="mt-3 flex gap-2"><Button variant="secondary" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>معاينة المستلمين</Button><Button disabled={!preview} loading={createMutation.isPending} onClick={() => createMutation.mutate()}><Megaphone className="h-4 w-4" />تجهيز الحملة</Button></div>
      {preview && <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><p className="text-xs text-concrete-500">إجمالي المرشحين</p><p className="tnum text-2xl font-bold">{preview.totalCount}</p></div>
        <div><p className="text-xs text-concrete-500">جاهزون برقم صالح</p><p className="tnum text-2xl font-bold text-pine-700">{preview.readyCount}</p></div>
        <div><p className="text-xs text-concrete-500">مستبعدون بلا رقم</p><p className="tnum text-2xl font-bold text-debt-600">{preview.skippedCount}</p></div>
        <div className="sm:col-span-3 flex flex-wrap gap-3">{Object.entries(preview.totalByCurrency).map(([code, amount]) => <Money key={code} value={amount} currency={code} />)}</div>
      </div>}
    </Card>

    <Card className="overflow-hidden">
      <DataState isLoading={campaigns.isLoading} isError={campaigns.isError} error={campaigns.error} onRetry={() => campaigns.refetch()} isFetching={campaigns.isFetching} isEmpty={!campaigns.data?.length} emptyTitle="لا توجد حملات مجهزة" skeletonClassName="h-48">
        <Table><THead cols={['الحملة', 'الشريحة', 'القناة', 'الجاهز', 'المستبعد', 'التاريخ', '']} /><tbody>{(campaigns.data ?? []).map((campaign) => <TRow key={campaign.id} onClick={() => setSelectedCampaign(campaign.id)}>
          <TD className="font-semibold">{campaign.name}</TD><TD>{BUCKETS.find(([value]) => value === campaign.agingBucket)?.[1] ?? campaign.agingBucket}</TD><TD>{campaign.channel === 'whatsapp' ? 'واتساب' : 'SMS'}</TD><TD className="tnum">{campaign.readyCount}</TD><TD className="tnum">{campaign.skippedCount}</TD><TD>{fmtDate(campaign.createdAt)}</TD><TD><Button variant="ghost" onClick={() => setSelectedCampaign(campaign.id)}>فتح</Button></TD>
        </TRow>)}</tbody></Table>
      </DataState>
    </Card>

    {selectedCampaign && <Card className="overflow-hidden">
      <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10"><h2 className="font-semibold">سجل الإرسال اليدوي</h2><p className="text-xs text-concrete-500">فتح واتساب أو الرسائل يسجل العملية، ولا توجد عملية إرسال آلي قبل اعتماد مزود رسمي وموافقة العملاء.</p></div>
      <DataState isLoading={detail.isLoading} isError={detail.isError} error={detail.error} onRetry={() => detail.refetch()} isFetching={detail.isFetching} isEmpty={!detail.data?.dispatches.length} emptyTitle="لا توجد سجلات" skeletonClassName="h-40">
        <Table><THead cols={['العميل', 'الوجهة', 'الحالة', 'الرسالة', 'الإجراء']} /><tbody>{(detail.data?.dispatches ?? []).map((dispatch) => <TRow key={dispatch.id}>
          <TD><span className="font-semibold">{dispatch.customer.name}</span><p dir="ltr" className="text-xs text-concrete-500">{dispatch.customer.externalCustomerCode}</p></TD><TD><span dir="ltr">{dispatch.destination ?? '—'}</span></TD><TD><Badge tone={dispatch.status === 'skipped_no_phone' ? 'debt' : dispatch.status === 'opened_manual' ? 'pine' : 'neutral'}>{dispatch.status}</Badge></TD><TD className="max-w-sm text-xs">{dispatch.renderedMessage}</TD><TD><Button disabled={!dispatch.manualUrl} onClick={() => openManual(detail.data!.id, dispatch)}>{dispatch.status === 'opened_manual' ? <ExternalLink className="h-4 w-4" /> : <Send className="h-4 w-4" />}فتح</Button></TD>
        </TRow>)}</tbody></Table>
      </DataState>
    </Card>}
  </div>;
}
