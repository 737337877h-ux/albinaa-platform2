'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/app-shell';
import { ConfirmDialog } from '@/components/ui/advanced';
import { DataState } from '@/components/ui/data-state';
import { Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';

interface Period { id: string; year: number; month: number; status: 'locked' | 'open'; reason: string; lockedAt: string; unlockReason?: string | null }
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export default function AccountingPeriodsPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [reason, setReason] = useState('إقفال شهري معتمد');
  const [pending, setPending] = useState<{ type: 'lock'; month: number } | { type: 'unlock'; period: Period } | null>(null);
  const query = useQuery({ queryKey: ['accounting-periods', year], queryFn: () => api<Period[]>(`/accounting-periods?year=${year}`) });
  const mutation = useMutation({
    mutationFn: () => pending?.type === 'lock'
      ? api('/accounting-periods/lock', { method: 'POST', body: JSON.stringify({ year, month: pending.month, reason }) })
      : api(`/accounting-periods/${pending?.period.id}/unlock`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => { toast(pending?.type === 'lock' ? 'تم إقفال الفترة المحاسبية' : 'تم فتح الفترة المحاسبية', 'ok'); setPending(null); qc.invalidateQueries({ queryKey: ['accounting-periods'] }); },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const byMonth = new Map((query.data ?? []).map((period) => [period.month, period]));

  return <div className="space-y-5">
    <PageHeader title="الفترات المحاسبية" />
    <Card className="p-5">
      <div className="flex items-start gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-gold/10 text-gold"><CalendarClock /></span><div><h2 className="font-bold">حماية القيود بعد الإقفال</h2><p className="mt-1 text-sm text-ink-mid">يمنع النظام التحصيلات والاستيرادات المؤرخة داخل شهر مقفل. التجاوز يتطلب صلاحية خاصة وسببًا موثقًا.</p></div></div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Field label="السنة"><Input type="number" min={2000} max={2200} value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
        <Field label="الشهر"><Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</Select></Field>
        <Field label="سبب الإجراء"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
      </div>
      <Button className="mt-4" variant="danger" disabled={reason.trim().length < 3 || byMonth.get(month)?.status === 'locked'} onClick={() => setPending({ type: 'lock', month })}><LockKeyhole className="h-4 w-4" />إقفال {MONTHS[month - 1]}</Button>
    </Card>

    <DataState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} isEmpty={false}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{MONTHS.map((name, index) => {
        const period = byMonth.get(index + 1); const locked = period?.status === 'locked';
        return <Card key={name} className="p-4"><div className="flex items-center justify-between"><div><p className="font-bold">{name} {year}</p><p className="mt-1 text-xs text-ink-mid">{locked ? period.reason : 'الفترة مفتوحة'}</p></div><span className={locked ? 'text-[var(--risk-crit)]' : 'text-brand'}>{locked ? <LockKeyhole /> : <LockKeyholeOpen />}</span></div>{locked && <Button className="mt-4 w-full" variant="secondary" onClick={() => setPending({ type: 'unlock', period })}>فتح الفترة</Button>}</Card>;
      })}</div>
    </DataState>
    <ConfirmDialog open={!!pending} onClose={() => setPending(null)} title={pending?.type === 'lock' ? 'تأكيد إقفال الفترة' : 'تأكيد فتح الفترة'} description="سيُسجل هذا القرار في سجل التدقيق. تأكد من اكتمال المراجعة المحاسبية قبل المتابعة." confirmWord={pending?.type === 'lock' ? 'إقفال' : 'فتح'} loading={mutation.isPending} onConfirm={() => mutation.mutate()} />
  </div>;
}
