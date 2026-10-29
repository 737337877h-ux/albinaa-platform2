'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, FileCheck2, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Dialog } from '@/components/ui/dialog';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, CardHeader, Field, Select, StatCard, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDateTime, fmtMoney } from '@/lib/format';

type Decision = 'keep_excluded' | 'adopt_oracle_amount' | 'publish_inventory_snapshot_and_retry'
  | 'publish_verified_historical_collection' | 'reassign_historical_invoice';
type ReviewMode = 'unreviewed' | 'reviewed' | 'all';
type ExceptionItem = {
  id: string; kind: 'customer' | 'inventory'; sourceSchema: string; sourceRunId: string;
  fingerprint: string; status: string; reasonCode: string; businessKey: string | null;
  details: Record<string, unknown> | null; firstSeenAt: string; lastSeenAt: string;
  review: null | { id: string; decision: Decision; status: string; notes: string; reviewedAt: string; reviewerName: string | null };
};
type ExceptionResponse = {
  mode: 'platform_review_only'; oracleWriteEnabled: false;
  counts: { total: number; unreviewed: number; reviewed: number }; items: ExceptionItem[];
};

const reasonCopy: Record<string, { title: string; hint: string; tone: 'hazard' | 'debt' | 'neutral' }> = {
  before_publication_cutoff: {
    title: 'حركة تاريخية قبل تاريخ بدء النشر',
    hint: 'تبقى مستبعدة نهائيًا من النشر التلقائي حسب المخطط المعتمد.', tone: 'neutral',
  },
  historical_sales_return_pending_review: {
    title: 'مردود مبيعات بتاريخ سابق',
    hint: 'معلّق للمراجعة ولا يجوز استبعاده حاليًا؛ سيُحدد مسار نشره بعد ربطه بفاتورة البيع الأصلية.', tone: 'hazard',
  },
  amount_conflict_same_business_key: {
    title: 'اختلاف مبلغ لنفس المستند',
    hint: 'مبلغ Oracle يختلف عن الحركة الموجودة في النسخة التجريبية ويحتاج قرارًا منفردًا.', tone: 'debt',
  },
  unknown_item_in_active_snapshot: {
    title: 'صنف جديد غير موجود في لقطة المخزون النشطة',
    hint: 'يلزم التحقق من أحدث لقطة مخزون واعتمادها قبل إعادة محاولة نشر الحركة.', tone: 'hazard',
  },
  changed_existing_inventory_business_key: {
    title: 'تغيّر مؤثر في حركة مخزون منشورة سابقًا',
    hint: 'المستند والصنف والمستودع متطابقة مع حركة منشورة، لكن الكمية أو الاتجاه أو وحدة القياس تغيّرت؛ يلزم التحقيق قبل أي قرار.', tone: 'hazard',
  },
};
const decisionCopy: Record<Decision, string> = {
  keep_excluded: 'تأكيد الاستبعاد',
  adopt_oracle_amount: 'اعتماد مبلغ Oracle',
  publish_inventory_snapshot_and_retry: 'اعتماد لقطة المخزون وإعادة المحاولة',
  publish_verified_historical_collection: 'نشر التحصيل السابق الموثق',
  reassign_historical_invoice: 'تصحيح إسناد الفاتورة',
};

function text(value: unknown) { return value === null || value === undefined || value === '' ? '—' : String(value); }
function amount(value: unknown) { return value === null || value === undefined ? '—' : fmtMoney(Number(value)); }
function actionsFor(item: ExceptionItem): Decision[] {
  if (item.reasonCode === 'historical_sales_return_pending_review') return [];
  if (item.kind === 'customer' && item.reasonCode === 'before_publication_cutoff' &&
      String(item.details?.externalCustomerCode) === '30667' && String(item.details?.documentNumber) === '3394') {
    return ['publish_verified_historical_collection'];
  }
  if (item.kind === 'customer' && item.reasonCode === 'before_publication_cutoff' &&
      String(item.details?.externalCustomerCode) === '20563' && String(item.details?.documentNumber) === '4875') {
    return ['reassign_historical_invoice'];
  }
  if (item.kind === 'customer' && item.reasonCode === 'before_publication_cutoff' &&
      String(item.details?.externalCustomerCode) === '20561' && String(item.details?.documentNumber) === '4789') {
    return ['adopt_oracle_amount'];
  }
  if (item.reasonCode === 'amount_conflict_same_business_key') return ['adopt_oracle_amount', 'keep_excluded'];
  if (item.reasonCode === 'unknown_item_in_active_snapshot') return ['publish_inventory_snapshot_and_retry', 'keep_excluded'];
  return ['keep_excluded'];
}

export default function OracleExceptionReviewPage() {
  const can = useCan();
  const allowed = can('settings.manage');
  const queryClient = useQueryClient();
  const [reviewMode, setReviewMode] = useState<ReviewMode>('unreviewed');
  const [kind, setKind] = useState('all');
  const [reason, setReason] = useState('all');
  const [pending, setPending] = useState<{ item: ExceptionItem; decision: Decision } | null>(null);
  const [notes, setNotes] = useState('');

  const params = useMemo(() => {
    const search = new URLSearchParams({ review: reviewMode });
    if (kind !== 'all') search.set('kind', kind);
    if (reason !== 'all') search.set('reason', reason);
    return search.toString();
  }, [kind, reason, reviewMode]);
  const query = useQuery<ExceptionResponse>({
    queryKey: ['oracle-exceptions', params],
    queryFn: () => api(`/oracle-monitoring/exceptions?${params}`),
    enabled: allowed,
  });
  const review = useMutation({
    mutationFn: ({ item, decision, notes: reviewNotes }: { item: ExceptionItem; decision: Decision; notes: string }) =>
      api(`/oracle-monitoring/exceptions/${item.id}/review`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ decision, notes: reviewNotes }),
      }),
    onSuccess: async () => {
      toast('تم حفظ قرار المراجعة في النسخة التجريبية فقط', 'ok');
      setPending(null); setNotes('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['oracle-exceptions'] }),
        queryClient.invalidateQueries({ queryKey: ['oracle-monitoring-summary'] }),
      ]);
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  if (!allowed) return <PermissionNotice message="هذه الشاشة متاحة لمدير النظام فقط." />;

  const openDecision = (item: ExceptionItem, decision: Decision) => { setPending({ item, decision }); setNotes(''); };
  const submit = () => {
    if (!pending || notes.trim().length < 3) return;
    review.mutate({ ...pending, notes: notes.trim() });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="مراجعة استثناءات Oracle" action={(
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/oracle-monitoring"><Button variant="secondary"><ArrowRight className="h-4 w-4" /> المراقبة</Button></Link>
          <Button variant="secondary" loading={query.isFetching} onClick={() => query.refetch()}><RefreshCw className="h-4 w-4" /> تحديث</Button>
        </div>
      )} />

      <Card className="border-credit-600/25">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-credit-50 text-credit-700"><ShieldCheck className="h-5 w-5" /></span>
            <div><h2 className="font-display font-bold">مراجعة داخل النسخة التجريبية فقط</h2><p className="mt-1 text-sm text-ink-mid">لا ترسل هذه الشاشة أي كتابة أو حذف أو تعديل إلى Oracle. لا يوجد اعتماد جماعي؛ كل استثناء له قرار مستقل وسجل تدقيق.</p></div>
          </div>
          <Badge tone="credit">Oracle للقراءة فقط</Badge>
        </div>
      </Card>

      {query.data && <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="إجمالي الاستثناءات" value={query.data.counts.total} icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard label="بانتظار قرار" value={query.data.counts.unreviewed} icon={<FileCheck2 className="h-4 w-4" />} tone={query.data.counts.unreviewed ? 'critical' : 'normal'} />
        <StatCard label="تمت مراجعتها" value={query.data.counts.reviewed} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>}

      <Card>
        <CardHeader title="التصفية" />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="حالة المراجعة"><Select value={reviewMode} onChange={(event) => setReviewMode(event.target.value as ReviewMode)}>
            <option value="unreviewed">بانتظار قرار</option><option value="reviewed">تمت مراجعتها</option><option value="all">الكل</option>
          </Select></Field>
          <Field label="نوع الحركة"><Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="all">الكل</option><option value="customer">حركات العملاء</option><option value="inventory">حركات المخزون</option>
          </Select></Field>
          <Field label="سبب الاستثناء"><Select value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="all">كل الأسباب</option><option value="amount_conflict_same_business_key">اختلاف مبلغ المستند</option>
            <option value="unknown_item_in_active_snapshot">صنف جديد</option><option value="historical_sales_return_pending_review">مردود مبيعات سابق</option>
            <option value="before_publication_cutoff">حركة تاريخية أخرى</option>
          </Select></Field>
        </div>
      </Card>

      <DataState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}
        isFetching={query.isFetching} isEmpty={query.data?.items.length === 0} emptyTitle="لا توجد استثناءات ضمن هذا الاختيار" skeletonClassName="h-48">
        <div className="space-y-3">
          {query.data?.items.map((item) => {
            const copy = reasonCopy[item.reasonCode] ?? { title: item.reasonCode, hint: 'يحتاج مراجعة مدير النظام.', tone: 'hazard' as const };
            const details = item.details ?? {};
            return <Card key={item.id} className="overflow-hidden">
              <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-brand">{item.kind === 'customer' ? <UserRound className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}</span>
                    <h3 className="font-display font-bold">{copy.title}</h3><Badge tone={copy.tone}>{item.kind === 'customer' ? 'عميل' : 'مخزون'}</Badge>
                    {item.review && <Badge tone="credit">تمت المراجعة</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-ink-mid">{copy.hint}</p>
                  <div className="mt-3 grid gap-x-6 gap-y-2 rounded-lg bg-surface-2 p-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    {item.kind === 'customer' ? <>
                      <div><span className="text-xs text-ink-mid">رقم العميل</span><p className="tnum font-bold">{text(details.externalCustomerCode)}</p></div>
                      <div><span className="text-xs text-ink-mid">المستند</span><p className="tnum font-bold">{text(details.documentNumber)}</p></div>
                      <div><span className="text-xs text-ink-mid">تاريخ الحركة</span><p dir="ltr" className="tnum text-right font-bold">{text(details.documentDate)}</p></div>
                      <div><span className="text-xs text-ink-mid">العملة</span><p className="font-bold">{text(details.currencyCode ?? details.platformCurrency ?? item.businessKey?.split('|')[1])}</p></div>
                      {item.reasonCode === 'amount_conflict_same_business_key' && <>
                        <div><span className="text-xs text-ink-mid">مدين Oracle</span><p className="tnum font-bold">{amount(details.sourceGroupDebit)}</p></div>
                        <div><span className="text-xs text-ink-mid">مدين المنصة</span><p className="tnum font-bold">{amount(details.platformGroupDebit)}</p></div>
                        <div><span className="text-xs text-ink-mid">دائن Oracle</span><p className="tnum font-bold">{amount(details.sourceGroupCredit)}</p></div>
                        <div><span className="text-xs text-ink-mid">دائن المنصة</span><p className="tnum font-bold">{amount(details.platformGroupCredit)}</p></div>
                      </>}
                    </> : <>
                      <div><span className="text-xs text-ink-mid">رمز الصنف</span><p className="tnum font-bold">{text(details.externalItemCode)}</p></div>
                      <div><span className="text-xs text-ink-mid">المستودع</span><p className="tnum font-bold">{text(details.warehouseCode ?? details.externalWarehouseCode)}</p></div>
                      <div><span className="text-xs text-ink-mid">تاريخ الحركة</span><p dir="ltr" className="tnum text-right font-bold">{text(details.movementDate)}</p></div>
                      <div><span className="text-xs text-ink-mid">المستند</span><p className="tnum font-bold">{text(details.documentNumber)}</p></div>
                    </>}
                  </div>
                  <p className="mt-2 text-xs text-ink-mid">آخر ظهور: <span dir="ltr" className="tnum">{fmtDateTime(item.lastSeenAt)}</span></p>
                  {item.review && <div className="mt-3 rounded-lg border border-credit-600/20 bg-credit-50 p-3 text-sm dark:bg-credit-700/10">
                    <p className="font-bold">{decisionCopy[item.review.decision]}</p><p className="mt-1">{item.review.notes}</p>
                    <p className="mt-1 text-xs text-ink-mid">بواسطة {item.review.reviewerName ?? 'مدير النظام'} — <span dir="ltr">{fmtDateTime(item.review.reviewedAt)}</span></p>
                  </div>}
                </div>
                {!item.review && <div className="flex shrink-0 flex-col gap-2 lg:w-64">
                  {actionsFor(item).map((decision) => <Button key={decision} variant={decision === 'keep_excluded' ? 'secondary' : 'primary'} onClick={() => openDecision(item, decision)}>{decisionCopy[decision]}</Button>)}
                  {item.reasonCode === 'historical_sales_return_pending_review' && <div className="rounded-lg border border-hazard-600/25 bg-hazard-50 p-3 text-center text-sm font-semibold text-hazard-700 dark:bg-hazard-700/10">معلّق — الاستبعاد غير مسموح</div>}
                </div>}
              </div>
            </Card>;
          })}
        </div>
      </DataState>

      <Dialog open={!!pending} onClose={() => !review.isPending && setPending(null)} title={pending ? decisionCopy[pending.decision] : 'تأكيد القرار'}>
        {pending && <div className="space-y-4">
          <div className={`rounded-lg border p-3 text-sm ${pending.decision === 'keep_excluded' ? 'border-line bg-surface-2' : 'border-hazard-600/30 bg-hazard-50 dark:bg-hazard-700/10'}`}>
            {pending.decision === 'keep_excluded' && 'سيُحفظ قرار الاستبعاد فقط، دون تعديل بيانات Oracle أو الحركات الموجودة في المنصة.'}
            {pending.decision === 'adopt_oracle_amount' && 'سيُعتمد مبلغ Oracle في النسخة التجريبية: تُعكس الحركة القديمة دون حذفها، تُنشأ حركة بديلة، ثم يُعاد حساب رصيد العميل. Oracle لن يتغير.'}
            {pending.decision === 'publish_inventory_snapshot_and_retry' && 'سيتم التحقق من أحدث لقطة مخزون ونشرها في النسخة التجريبية، ثم إعادة محاولة الحركة الجديدة فقط. Oracle لن يتغير.'}
            {pending.decision === 'publish_verified_historical_collection' && 'سيُنشر التحصيل رقم 3394 فقط بقيمة دائن 575 SAR للعميل 30667، ثم يُعاد حساب رصيده ليطابق Oracle. لن تُنشر أي حركة تاريخية أخرى، ولن يتغير Oracle.'}
            {pending.decision === 'reassign_historical_invoice' && 'ستُعكس الفاتورة 4875 على العميل 30984 دون حذفها، ثم تُنشأ بالقيمة نفسها 760,000 YER على العميل 20563 وتُعاد حسابات الرصيدين. إجمالي المنصة لن يتغير، ولن يتغير Oracle.'}
          </div>
          <Field label="سبب القرار أو ملاحظة التحقيق" hint="إلزامي ويظهر في سجل التدقيق." error={notes.length > 0 && notes.trim().length < 3 ? 'اكتب ثلاثة أحرف على الأقل.' : undefined}>
            <Textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="مثال: تمت المطابقة مع كشف الحساب واعتماد مبلغ Oracle..." />
          </Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" disabled={review.isPending} onClick={() => setPending(null)}>إلغاء</Button>
            <Button loading={review.isPending} disabled={notes.trim().length < 3} onClick={submit}>تأكيد القرار</Button></div>
        </div>}
      </Dialog>
    </div>
  );
}
