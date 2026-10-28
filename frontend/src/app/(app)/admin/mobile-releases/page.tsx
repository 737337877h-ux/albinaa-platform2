'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileUp, Send, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { Badge, Button, Card, ErrorNote, Field, Input, Textarea } from '@/components/ui/primitives';
import { api, downloadApiFile } from '@/lib/api';
import { useCan } from '@/lib/auth';

type Release = {
  id: string;
  versionName: string;
  versionCode: number;
  notes: string;
  mandatory: boolean;
  status: 'draft' | 'published' | 'archived';
  originalFileName: string;
  size: number;
  sha256: string;
  createdAt: string;
  publishedAt: string | null;
  downloadPath: string;
};

const statusLabel = { draft: 'مسودة', published: 'منشور', archived: 'سابق' } as const;

export default function MobileReleasesPage() {
  const allowed = useCan()('settings.manage');
  const queryClient = useQueryClient();
  const [application, setApplication] = useState<'collector' | 'operations'>('collector');
  const channel = (path = '') => `/mobile-app-releases${path}?application=${application}`;
  const [file, setFile] = useState<File | null>(null);
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [notes, setNotes] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const releases = useQuery<Release[]>({
    queryKey: ['mobile-app-releases', application],
    queryFn: () => api(channel()),
    enabled: allowed,
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('اختر ملف APK');
      const body = new FormData();
      body.append('file', file);
      body.append('versionName', versionName);
      body.append('versionCode', versionCode);
      body.append('notes', notes);
      body.append('mandatory', String(mandatory));
      return api<Release>(channel('/drafts'), { method: 'POST', body });
    },
    onSuccess: async () => {
      setFile(null); setVersionName(''); setVersionCode(''); setNotes(''); setMandatory(false);
      await queryClient.invalidateQueries({ queryKey: ['mobile-app-releases'] });
    },
  });
  const publish = useMutation({
    mutationFn: (id: string) => api<Release>(channel(`/${id}/publish`), { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mobile-app-releases'] }),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); upload.mutate(); };

  if (!allowed) return <Card className="p-5">لا تملك صلاحية إدارة تحديثات التطبيق.</Card>;
  return <div className="space-y-5">
    <PageHeader title="تحديث تطبيق الهاتف" />
    <Card className="p-4"><Field label="التطبيق"><select className="w-full rounded-lg border border-line bg-surface p-3" value={application} disabled={upload.isPending || publish.isPending} onChange={event => { setApplication(event.target.value as 'collector' | 'operations'); setFile(null); setVersionName(''); setVersionCode(''); setNotes(''); setMandatory(false); upload.reset(); publish.reset(); }}><option value="collector">تطبيق التحصيل</option><option value="operations">الراقي إدارة العملاء والمخزون</option></select></Field><p className="mt-2 text-sm text-ink-mid">لكل تطبيق إصداراته المستقلة. تُفحص هوية ملف APK قبل حفظه.</p></Card>
    <Card className="border-hazard-600/30 bg-hazard-100/50 p-4 dark:bg-hazard-700/10">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-hazard-700" />
        <div><p className="font-bold">الرفع لا يعني النشر</p><p className="mt-1 text-sm text-ink-mid">يُحفظ ملف التطبيق أولًا كمسودة. لا يصل للمستخدمين إلا بعد الضغط على «نشر للمستخدمين» والتأكيد الصريح.</p></div>
      </div>
    </Card>

    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
        <Field label="ملف التطبيق APK"><Input key={application} type="file" accept=".apk,application/vnd.android.package-archive" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></Field>
        <Field label="اسم الإصدار" hint="مثال: 1.3.23"><Input dir="ltr" value={versionName} onChange={(event) => setVersionName(event.target.value)} required /></Field>
        <Field label="رقم الإصدار الداخلي" hint="يجب أن يكون أكبر من الإصدار السابق"><Input dir="ltr" type="number" min="1" step="1" value={versionCode} onChange={(event) => setVersionCode(event.target.value)} required /></Field>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-line px-3 text-sm"><input type="checkbox" checked={mandatory} onChange={(event) => setMandatory(event.target.checked)} />تحديث إلزامي</label>
        <div className="lg:col-span-2"><Field label="ملاحظات الإصدار"><Textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ما الجديد وما الذي تم إصلاحه؟" /></Field></div>
        {(upload.error || publish.error) && <div className="lg:col-span-2"><ErrorNote message={(upload.error || publish.error)?.message ?? 'تعذر تنفيذ العملية'} /></div>}
        <div className="lg:col-span-2"><Button type="submit" loading={upload.isPending}><FileUp className="h-4 w-4" />حفظ كمسودة</Button></div>
      </form>
    </Card>

    <div className="space-y-3">
      {(releases.data ?? []).map((release) => <Card key={release.id} className="p-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-3"><Smartphone className="h-5 w-5 text-brand" /></span>
            <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold" dir="ltr">v{release.versionName} ({release.versionCode})</h2><Badge tone={release.status === 'published' ? 'credit' : release.status === 'draft' ? 'hazard' : 'neutral'}>{statusLabel[release.status]}</Badge>{release.mandatory && <Badge tone="debt">إلزامي</Badge>}</div><p className="mt-1 text-sm text-ink-mid">{release.notes || 'لا توجد ملاحظات'}</p><p className="mt-2 text-xs text-ink-low">الحجم {(release.size / 1024 / 1024).toFixed(1)} MB · SHA-256: <span dir="ltr">{release.sha256.slice(0, 14)}…</span></p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => downloadApiFile(release.downloadPath, `albinaa-mobile-${release.versionName}.apk`)}><Download className="h-4 w-4" />تنزيل</Button>
            {release.status === 'draft' && <Button type="button" variant="success" loading={publish.isPending} onClick={() => {
              const confirmed = window.confirm(`سيصل الإصدار ${release.versionName} لمستخدمي ${application === 'operations' ? 'إدارة العملاء والمخزون' : 'التحصيل'} عند فحص التحديث. هل توافق على النشر الآن؟`);
              if (confirmed) publish.mutate(release.id);
            }}><Send className="h-4 w-4" />نشر للمستخدمين</Button>}
            {release.status === 'published' && <span className="inline-flex items-center gap-2 text-sm font-bold text-credit-700"><CheckCircle2 className="h-4 w-4" />الإصدار الحالي</span>}
          </div>
        </div>
      </Card>)}
      {!releases.isLoading && (releases.data?.length ?? 0) === 0 && <Card className="p-8 text-center text-ink-mid">لا توجد إصدارات مرفوعة بعد.</Card>}
    </div>
  </div>;
}
