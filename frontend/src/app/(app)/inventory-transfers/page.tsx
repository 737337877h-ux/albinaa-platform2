'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine, ArrowRightLeft, CheckCircle2, ChevronDown, ChevronUp,
  CircleDashed, ClipboardCheck, PackagePlus, Plus, RefreshCw, Send, Trash2, XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import {
  oracleStateLabel,
  preferredTransferUnit,
  TRANSFER_STATUS_AR,
  transferAvailableQuantity,
  transferStatusTone,
} from '@/lib/inventory-transfers';
import type {
  OracleInventoryItem,
  OracleItemDetail,
  OracleItemsResponse,
  OracleWarehousesResponse,
} from '@/lib/oracle-inventory';

interface TransferLine {
  id: string;
  lineNo: number;
  itemCode: string;
  itemName: string | null;
  unitCode: string;
  quantity: string | number;
}

interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  lineNo?: number;
  message: string;
}

interface OracleTransferStatus {
  sourceTransferSerial: string | null;
  destinationTransferSerial: string | null;
  sourceIssued: boolean;
  destinationReceived: boolean;
  transferCompleted: boolean;
}

interface DryRunResult {
  valid: boolean;
  allowInsufficientStock?: boolean;
  checkedAt: string;
  oracleWriteAttempted: false;
  issues: ValidationIssue[];
  lines: Array<{
    lineNo: number;
    itemCode: string;
    unitCode: string;
    quantity: number;
    packageSize: number | null;
    availableQuantity: number;
  }>;
  oracleTransferStatus: OracleTransferStatus | null;
}

interface InventoryTransfer {
  id: string;
  idempotencyKey: string;
  sourceWarehouseCode: string;
  destinationWarehouseCode: string;
  status: string;
  notes: string | null;
  reviewNote: string | null;
  oracleOutReqNo: string | null;
  oracleOutReqSer: string | null;
  oracleSourceTransferSerial: string | null;
  oracleDestinationTransferSerial: string | null;
  sourceIssued: boolean;
  destinationReceived: boolean;
  transferCompleted: boolean;
  lastOracleCheckedAt: string | null;
  lastDryRunAt: string | null;
  lastDryRunResult: DryRunResult | null;
  createdAt: string;
  lines: TransferLine[];
}

interface FormLine { clientId: string; itemCode: string; itemName: string; unitCode: string; quantity: string }
interface CreateForm {
  sourceWarehouseCode: string;
  destinationWarehouseCode: string;
  notes: string;
  lines: FormLine[];
}

const EMPTY_LINE: FormLine = { clientId: 'initial', itemCode: '', itemName: '', unitCode: '', quantity: '' };
const EMPTY_FORM: CreateForm = {
  sourceWarehouseCode: '', destinationWarehouseCode: '', notes: '',
  lines: [{ ...EMPTY_LINE }],
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function quantity(value: string | number) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export default function InventoryTransfersPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [review, setReview] = useState<{ request: InventoryTransfer; action: 'approve' | 'reject' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const transfers = useQuery({
    queryKey: ['inventory-transfers'],
    queryFn: () => api<InventoryTransfer[]>('/inventory-transfers'),
    enabled: can('inventory_transfers.read'),
    refetchInterval: 60_000,
  });

  const action = useMutation({
    mutationFn: async ({ request, action, note }: { request: InventoryTransfer; action: 'submit' | 'dry-run' | 'approve' | 'reject' | 'refresh'; note?: string }) => {
      const path = action === 'refresh' ? 'oracle-status/refresh' : action;
      const idempotent = ['submit', 'approve', 'reject'].includes(action);
      return api(`/inventory-transfers/${request.id}/${path}`, {
        method: 'POST',
        headers: idempotent ? { 'Idempotency-Key': idempotencyKey(`inventory-transfer-${action}`) } : undefined,
        body: ['approve', 'reject'].includes(action) ? JSON.stringify({ note: note?.trim() || undefined }) : undefined,
      });
    },
    onSuccess: async (_, variables) => {
      const labels = { submit: 'تم إرسال الطلب للاعتماد', 'dry-run': 'اكتمل فحص Oracle للقراءة فقط', approve: 'تم اعتماد الطلب', reject: 'تم رفض الطلب', refresh: 'تم تحديث حالة Oracle' };
      toast(labels[variables.action], 'ok');
      setReview(null); setReviewNote('');
      await queryClient.invalidateQueries({ queryKey: ['inventory-transfers'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });

  const rows = useMemo(() => (transfers.data ?? []).filter((row) => filter === 'all' || row.status === filter), [filter, transfers.data]);
  const counts = useMemo(() => ({
    all: transfers.data?.length ?? 0,
    pending: transfers.data?.filter((row) => row.status === 'pending_approval').length ?? 0,
    completed: transfers.data?.filter((row) => row.transferCompleted).length ?? 0,
    awaiting: transfers.data?.filter((row) => row.sourceIssued && !row.destinationReceived).length ?? 0,
  }), [transfers.data]);

  if (!can('inventory_transfers.read')) return <PermissionNotice message="لا تملك صلاحية عرض التحويلات المخزنية." />;

  return (
    <div className="space-y-5">
      <PageHeader title="التحويلات المخزنية" action={can('inventory_transfers.create') ? <Button onClick={() => setCreateOpen(true)}><PackagePlus className="h-4 w-4" />طلب تحويل جديد</Button> : undefined} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="إجمالي الطلبات" value={counts.all} icon={<ArrowRightLeft />} />
        <SummaryCard label="بانتظار الاعتماد" value={counts.pending} icon={<ClipboardCheck />} tone="hazard" />
        <SummaryCard label="تحويلات مكتملة" value={counts.completed} icon={<CheckCircle2 />} tone="credit" />
        <SummaryCard label="صادرة ولم تُستلم" value={counts.awaiting} icon={<ArrowDownToLine />} tone="debt" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display font-bold">طلبات التحويل</h2>
            <p className="mt-1 text-xs text-ink-mid">التحقق من الحالة قراءة فقط؛ وعند تفعيل بوابة الاختبار ينشئ الاعتماد طلب يمن سوفت مسودة دون حركة مخزون.</p>
          </div>
          <Select className="md:w-52" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="تصفية حالة الطلب">
            <option value="all">كل الحالات</option>
            <option value="draft">المسودات</option>
            <option value="pending_approval">بانتظار الاعتماد</option>
            <option value="approved">المعتمدة</option>
            <option value="rejected">المرفوضة</option>
          </Select>
        </div>
        <DataState
          isLoading={transfers.isLoading}
          isError={transfers.isError}
          error={transfers.error}
          onRetry={() => transfers.refetch()}
          isFetching={transfers.isFetching}
          isEmpty={rows.length === 0}
          emptyTitle="لا توجد طلبات تحويل"
          emptyHint="أنشئ طلبًا جديدًا، ثم شغّل Dry Run للتحقق من المخزون وحالة Oracle."
          skeletonClassName="m-4 h-52"
        >
          <div className="divide-y divide-line">
            {rows.map((request) => {
              const open = expanded === request.id;
              const busy = action.isPending && action.variables?.request.id === request.id;
              return (
                <section key={request.id} className="p-4">
                  <button type="button" className="flex w-full items-start gap-3 text-right" onClick={() => setExpanded(open ? null : request.id)} aria-expanded={open}>
                    <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><ArrowRightLeft className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="font-display" dir="ltr">{request.sourceWarehouseCode} → {request.destinationWarehouseCode}</strong>
                        <Badge tone={transferStatusTone(request.status)}>{TRANSFER_STATUS_AR[request.status] ?? request.status}</Badge>
                        <OracleBadge request={request} />
                      </span>
                      <span className="mt-1 block text-xs text-ink-mid">{request.lines.length} صنف • أُنشئ {formatDate(request.createdAt)}{request.oracleSourceTransferSerial ? ` • TR_SER ${request.oracleSourceTransferSerial}` : ''}</span>
                    </span>
                    {open ? <ChevronUp className="h-5 w-5 text-ink-mid" /> : <ChevronDown className="h-5 w-5 text-ink-mid" />}
                  </button>

                  {open && <div className="mt-4 space-y-4 border-t border-line pt-4">
                    <div className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
                      <div className="overflow-x-auto rounded-lg border border-line">
                        <table className="w-full text-sm">
                          <thead className="bg-surface-2 text-xs text-ink-mid"><tr><th className="px-3 py-2 text-right">#</th><th className="px-3 py-2 text-right">الصنف</th><th className="px-3 py-2 text-right">الوحدة</th><th className="px-3 py-2 text-right">الكمية</th><th className="px-3 py-2 text-right">المتاح</th></tr></thead>
                          <tbody className="divide-y divide-line">{request.lines.map((line) => {
                            const checked = request.lastDryRunResult?.lines.find((item) => item.lineNo === line.lineNo);
                            return <tr key={line.id}><td className="px-3 py-2 tnum">{line.lineNo}</td><td className="px-3 py-2"><span className="block font-medium">{line.itemName ?? 'اسم الصنف غير متاح'}</span><span className="mt-0.5 block text-xs text-ink-mid" dir="ltr">{line.itemCode}</span></td><td className="px-3 py-2">{line.unitCode}</td><td className="px-3 py-2 tnum">{quantity(line.quantity)}</td><td className="px-3 py-2 tnum">{checked ? quantity(checked.availableQuantity) : '—'}</td></tr>;
                          })}</tbody>
                        </table>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-2 p-4 text-sm">
                        <h3 className="font-semibold">حالة Oracle</h3>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                          <StateCell active={request.sourceIssued} label="صدر من المصدر" />
                          <StateCell active={request.destinationReceived} label="استلمته الوجهة" />
                          <StateCell active={request.transferCompleted} label="مكتمل" />
                        </div>
                        <dl className="mt-4 space-y-2 text-xs text-ink-mid">
                          <div className="flex justify-between gap-2"><dt>طلب يمن سوفت</dt><dd dir="ltr">{request.oracleOutReqNo ?? '—'}</dd></div>
                          <div className="flex justify-between gap-2"><dt>OUT_REQ_SER</dt><dd dir="ltr">{request.oracleOutReqSer ?? '—'}</dd></div>
                          <div className="flex justify-between gap-2"><dt>مستند المصدر</dt><dd dir="ltr">{request.oracleSourceTransferSerial ?? '—'}</dd></div>
                          <div className="flex justify-between gap-2"><dt>مستند الوجهة</dt><dd dir="ltr">{request.oracleDestinationTransferSerial ?? '—'}</dd></div>
                          <div className="flex justify-between gap-2"><dt>آخر فحص</dt><dd>{formatDate(request.lastOracleCheckedAt)}</dd></div>
                        </dl>
                      </div>
                    </div>

                    {request.transferCompleted
                      ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-credit-700/30 bg-credit-700/10 px-4 py-3 text-sm">
                          <span className="flex items-center gap-2 font-semibold text-credit-700"><CheckCircle2 className="h-5 w-5" />مكتمل في Oracle — لا يحتاج اعتماد</span>
                          <span className="text-xs text-ink-mid">اكتمل الصرف من المصدر والاستلام في الوجهة.</span>
                        </div>
                      : request.lastDryRunResult && <DryRunPanel result={request.lastDryRunResult} />}
                    {(request.notes || request.reviewNote) && <div className="grid gap-2 text-xs text-ink-mid md:grid-cols-2">{request.notes && <p><strong className="text-ink-hi">ملاحظات الطلب:</strong> {request.notes}</p>}{request.reviewNote && <p><strong className="text-ink-hi">ملاحظة المراجعة:</strong> {request.reviewNote}</p>}</div>}

                    <div className="flex flex-wrap gap-2">
                      {!request.transferCompleted && can('inventory_transfers.dry_run') && <Button variant="secondary" loading={busy && action.variables?.action === 'dry-run'} onClick={() => action.mutate({ request, action: 'dry-run' })}><CircleDashed className="h-4 w-4" />Dry Run</Button>}
                      {!request.transferCompleted && can('inventory_transfers.create') && ['draft', 'rejected'].includes(request.status) && <Button loading={busy && action.variables?.action === 'submit'} onClick={() => action.mutate({ request, action: 'submit' })}><Send className="h-4 w-4" />إرسال للاعتماد</Button>}
                      {!request.transferCompleted && can('inventory_transfers.approve') && request.status === 'pending_approval' && <><Button variant="success" onClick={() => { setReview({ request, action: 'approve' }); setReviewNote(''); }}><CheckCircle2 className="h-4 w-4" />اعتماد</Button><Button variant="danger" onClick={() => { setReview({ request, action: 'reject' }); setReviewNote(''); }}><XCircle className="h-4 w-4" />رفض</Button></>}
                      {request.status === 'approved' && !!(request.oracleOutReqSer || request.oracleSourceTransferSerial) && <Button variant="ghost" loading={busy && action.variables?.action === 'refresh'} onClick={() => action.mutate({ request, action: 'refresh' })}><RefreshCw className="h-4 w-4" />اكتشاف وتحديث حالة Oracle</Button>}
                    </div>
                  </div>}
                </section>
              );
            })}
          </div>
        </DataState>
      </Card>

      <CreateTransferDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <Dialog open={!!review} onClose={() => { if (!action.isPending) setReview(null); }} title={review?.action === 'approve' ? 'اعتماد طلب التحويل' : 'رفض طلب التحويل'}>
        <div className="space-y-4">
          <p className="text-sm text-ink-mid">{review?.action === 'approve' ? 'سيُعاد تشغيل Dry Run قبل الاعتماد. نقص الرصيد تنبيه فقط عند إنشاء طلب يمن سوفت؛ أخطاء الصنف أو الوحدة أو المستودع تمنع العملية.' : 'اكتب سبب الرفض ليظهر لصاحب الطلب ويُحفظ في سجل التدقيق.'}</p>
          <Field label={review?.action === 'reject' ? 'سبب الرفض *' : 'ملاحظة الاعتماد'}><Textarea rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setReview(null)}>إلغاء</Button><Button variant={review?.action === 'reject' ? 'danger' : 'success'} disabled={review?.action === 'reject' && !reviewNote.trim()} loading={action.isPending} onClick={() => review && action.mutate({ request: review.request, action: review.action, note: reviewNote })}>{review?.action === 'approve' ? 'تأكيد الاعتماد' : 'تأكيد الرفض'}</Button></div>
        </div>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, icon, tone = 'neutral' }: { label: string; value: number; icon: React.ReactNode; tone?: 'neutral' | 'hazard' | 'credit' | 'debt' }) {
  const colors = { neutral: 'text-brand bg-brand/10', hazard: 'text-hazard-700 bg-hazard-100', credit: 'text-credit-700 bg-credit-50', debt: 'text-debt-700 bg-debt-50' };
  return <Card className="flex items-center gap-3 p-4"><span className={`grid h-11 w-11 place-items-center rounded-xl ${colors[tone]}`}>{icon}</span><div><p className="text-xs text-ink-mid">{label}</p><p className="tnum mt-1 text-2xl font-extrabold">{value}</p></div></Card>;
}

function OracleBadge({ request }: { request: InventoryTransfer }) {
  const label = oracleStateLabel(request.sourceIssued, request.destinationReceived, request.transferCompleted);
  const tone = request.transferCompleted ? 'credit' : request.sourceIssued ? 'hazard' : 'neutral';
  return <Badge tone={tone}>{label}</Badge>;
}

function StateCell({ active, label }: { active: boolean; label: string }) {
  return <div className={`rounded-lg border p-2 ${active ? 'border-credit-600/30 bg-credit-50 text-credit-700 dark:bg-credit-700/20' : 'border-line bg-surface-1 text-ink-low'}`}>{active ? <CheckCircle2 className="mx-auto mb-1 h-4 w-4" /> : <CircleDashed className="mx-auto mb-1 h-4 w-4" />}{label}</div>;
}

function DryRunPanel({ result }: { result: DryRunResult }) {
  const warningsOnly = result.valid && result.issues.some((issue) => issue.severity === 'warning');
  return <div className={`rounded-lg border p-4 ${result.valid ? 'border-credit-600/20 bg-credit-50 dark:bg-credit-700/10' : 'border-debt-600/20 bg-debt-50 dark:bg-debt-700/10'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2">{result.valid ? <CheckCircle2 className="h-5 w-5 text-credit-700" /> : <XCircle className="h-5 w-5 text-debt-700" />}<strong className="text-sm">{warningsOnly ? 'Dry Run صالح مع تنبيه' : result.valid ? 'Dry Run صالح' : 'Dry Run يحتاج معالجة'}</strong></div><span className="text-xs text-ink-mid">{formatDate(result.checkedAt)} • لم تُجرَ أي كتابة في Oracle</span></div>
    {result.issues.length > 0 && <ul className="mt-3 space-y-1 text-xs">{result.issues.map((issue, index) => <li className={issue.severity === 'warning' ? 'text-hazard-700' : 'text-debt-700'} key={`${issue.code}-${issue.lineNo ?? 0}-${index}`}>• {issue.lineNo ? `السطر ${issue.lineNo}: ` : ''}{issue.message}</li>)}</ul>}
  </div>;
}

function CreateTransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const warehouses = useQuery({
    queryKey: ['inventory-transfer-lookups', 'warehouses'],
    queryFn: () => api<OracleWarehousesResponse>('/inventory-transfers/lookups/warehouses'),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const create = useMutation({
    mutationFn: () => {
      const key = idempotencyKey('inventory-transfer');
      return api('/inventory-transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          idempotencyKey: key,
          sourceWarehouseCode: form.sourceWarehouseCode.trim(),
          destinationWarehouseCode: form.destinationWarehouseCode.trim(),
          notes: form.notes.trim() || undefined,
          lines: form.lines.map((line) => ({ itemCode: line.itemCode.trim(), unitCode: line.unitCode.trim(), quantity: Number(line.quantity) })),
        }),
      });
    },
    onSuccess: async () => {
      toast('تم إنشاء طلب التحويل كمسودة', 'ok');
      setForm(EMPTY_FORM); onClose();
      await queryClient.invalidateQueries({ queryKey: ['inventory-transfers'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const valid = Boolean(form.sourceWarehouseCode.trim() && form.destinationWarehouseCode.trim()
    && form.sourceWarehouseCode.trim() !== form.destinationWarehouseCode.trim()
    && form.lines.length > 0 && form.lines.every((line) => line.itemCode.trim() && line.itemName.trim() && line.unitCode.trim() && Number(line.quantity) > 0));
  const close = () => { if (!create.isPending) { setForm(EMPTY_FORM); onClose(); } };
  const updateLine = (index: number, patch: Partial<FormLine>) => setForm((current) => ({
    ...current,
    lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
  }));
  const warehouseOptions = warehouses.data?.items ?? [];

  return <Dialog open={open} onClose={close} title="طلب تحويل مخزني جديد" className="sm:max-w-2xl">
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المستودع المصدر *">
          <Select value={form.sourceWarehouseCode} disabled={warehouses.isLoading || warehouses.isError} onChange={(event) => setForm((current) => ({ ...current, sourceWarehouseCode: event.target.value }))}>
            <option value="">{warehouses.isLoading ? 'جاري تحميل المستودعات…' : 'اختر المستودع المصدر'}</option>
            {warehouseOptions.filter((warehouse) => warehouse.externalWarehouseCode !== form.destinationWarehouseCode).map((warehouse) => <option key={warehouse.externalWarehouseCode} value={warehouse.externalWarehouseCode}>{warehouse.externalWarehouseCode} — {warehouse.nameAr}</option>)}
          </Select>
        </Field>
        <Field label="مستودع الوجهة *">
          <Select value={form.destinationWarehouseCode} disabled={warehouses.isLoading || warehouses.isError} onChange={(event) => setForm((current) => ({ ...current, destinationWarehouseCode: event.target.value }))}>
            <option value="">{warehouses.isLoading ? 'جاري تحميل المستودعات…' : 'اختر مستودع الوجهة'}</option>
            {warehouseOptions.filter((warehouse) => warehouse.externalWarehouseCode !== form.sourceWarehouseCode).map((warehouse) => <option key={warehouse.externalWarehouseCode} value={warehouse.externalWarehouseCode}>{warehouse.externalWarehouseCode} — {warehouse.nameAr}</option>)}
          </Select>
        </Field>
      </div>
      {warehouses.isError && <p role="alert" className="text-xs text-debt-600">تعذر تحميل مستودعات لقطة المخزون. حدّث الصفحة ثم حاول مجددًا.</p>}
      <div className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">الأصناف *</h3><Button type="button" variant="ghost" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, { ...EMPTY_LINE, clientId: idempotencyKey('line') }] }))}><Plus className="h-4 w-4" />إضافة صنف</Button></div>
        {form.lines.map((line, index) => <TransferLineEditor
          key={line.clientId}
          index={index}
          line={line}
          sourceWarehouseCode={form.sourceWarehouseCode}
          onChange={(linePatch) => updateLine(index, linePatch)}
          canRemove={form.lines.length > 1}
          onRemove={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}
        />)}
      </div>
      <Field label="ملاحظات" hint="اختياري"><Textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} maxLength={1000} /></Field>
      <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 text-xs text-ink-mid">هذا الإجراء يحفظ الطلب داخل منصة البناء الراقي فقط. لا يرسل أو يكتب أي مستند في Oracle.</div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={close}>إلغاء</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>حفظ كمسودة</Button></div>
    </div>
  </Dialog>;
}

function TransferLineEditor({ index, line, sourceWarehouseCode, onChange, canRemove, onRemove }: {
  index: number;
  line: FormLine;
  sourceWarehouseCode: string;
  onChange: (patch: Partial<FormLine>) => void;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const [search, setSearch] = useState(line.itemCode ? `${line.itemCode} — ${line.itemName}` : '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showChoices, setShowChoices] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const itemChoices = useQuery({
    queryKey: ['inventory-transfer-lookups', 'items', debouncedSearch],
    queryFn: () => api<OracleItemsResponse>(`/inventory-transfers/lookups/items?search=${encodeURIComponent(debouncedSearch)}&limit=20`),
    enabled: showChoices && debouncedSearch.length >= 2,
    staleTime: 60_000,
  });
  const itemDetail = useQuery({
    queryKey: ['inventory-transfer-lookups', 'item', line.itemCode],
    queryFn: () => api<OracleItemDetail>(`/inventory-transfers/lookups/items/${encodeURIComponent(line.itemCode)}`),
    enabled: Boolean(line.itemCode),
    staleTime: 60_000,
  });
  const activeUnits = useMemo(
    () => itemDetail.data?.units.filter((unit) => !unit.isInactive) ?? [],
    [itemDetail.data],
  );

  useEffect(() => {
    if (!itemDetail.data) return;
    const unitIsValid = activeUnits.some((unit) => unit.unitName === line.unitCode);
    if (!unitIsValid) onChange({ unitCode: preferredTransferUnit(itemDetail.data) });
  }, [activeUnits, itemDetail.data, line.unitCode, onChange]);

  const chooseItem = (item: OracleInventoryItem) => {
    setSearch(`${item.externalItemCode} — ${item.nameAr}`);
    setShowChoices(false);
    onChange({ itemCode: item.externalItemCode, itemName: item.nameAr, unitCode: '' });
  };
  const available = transferAvailableQuantity(itemDetail.data, sourceWarehouseCode, line.unitCode);

  return <div className="relative rounded-lg border border-line bg-surface-2 p-3">
    <div className="grid gap-2 sm:grid-cols-[1.4fr_.7fr_.55fr_auto]">
      <div className="relative space-y-1.5">
        <label htmlFor={`transfer-item-${index}`} className="block text-sm font-medium text-concrete-700 dark:text-concrete-200">الصنف {index + 1}</label>
        <Input
          id={`transfer-item-${index}`}
          value={search}
          autoComplete="off"
          placeholder="اكتب كود الصنف أو اسمه"
          onFocus={() => setShowChoices(true)}
          onBlur={() => window.setTimeout(() => setShowChoices(false), 150)}
          onChange={(event) => {
            setSearch(event.target.value);
            setShowChoices(true);
            if (line.itemCode) onChange({ itemCode: '', itemName: '', unitCode: '' });
          }}
        />
        {showChoices && debouncedSearch.length >= 2 && <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-line bg-surface-1 p-1 shadow-xl">
          {itemChoices.isLoading && <p className="px-3 py-2 text-xs text-ink-mid">جاري البحث…</p>}
          {itemChoices.isError && <p className="px-3 py-2 text-xs text-debt-600">تعذر البحث في الأصناف.</p>}
          {!itemChoices.isLoading && itemChoices.data?.items.length === 0 && <p className="px-3 py-2 text-xs text-ink-mid">لا يوجد صنف مطابق في لقطة المخزون.</p>}
          {itemChoices.data?.items.map((item) => <button key={item.externalItemCode} type="button" className="block w-full rounded-md px-3 py-2 text-right text-sm hover:bg-surface-3" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseItem(item)}><span className="font-semibold" dir="ltr">{item.externalItemCode}</span><span className="mt-0.5 block text-xs text-ink-mid">{item.nameAr}</span></button>)}
        </div>}
        {search.trim().length > 0 && search.trim().length < 2 && <span className="block text-xs text-ink-mid">اكتب حرفين على الأقل للبحث.</span>}
        {line.itemCode && <span className="block text-xs text-credit-700">تم اختيار صنف معتمد من لقطة Oracle.</span>}
      </div>
      <Field label="الوحدة">
        <Select value={line.unitCode} disabled={!line.itemCode || itemDetail.isLoading || itemDetail.isError} onChange={(event) => onChange({ unitCode: event.target.value })}>
          <option value="">{itemDetail.isLoading ? 'جاري التحميل…' : 'اختر الوحدة'}</option>
          {activeUnits.map((unit) => <option key={`${unit.unitName}-${unit.packageSize}`} value={unit.unitName}>{unit.unitName}</option>)}
        </Select>
      </Field>
      <Field label="الكمية"><Input type="number" min="0.0001" step="any" value={line.quantity} onChange={(event) => onChange({ quantity: event.target.value })} /></Field>
      <Button type="button" variant="ghost" className="self-end px-3 text-debt-600" aria-label={`حذف الصنف ${index + 1}`} disabled={!canRemove} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </div>
    {itemDetail.isError && <p role="alert" className="mt-2 text-xs text-debt-600">تعذر تحميل وحدات ورصيد هذا الصنف.</p>}
    {line.itemCode && itemDetail.data && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-mid">
      <span>الكود: <b dir="ltr" className="text-ink-hi">{line.itemCode}</b></span>
      <span>رصيد لقطة المصدر: <b className="tnum text-ink-hi">{sourceWarehouseCode && line.unitCode ? quantity(available) : 'اختر المصدر والوحدة'}</b></span>
      <span>سيؤكد Dry Run الرصيد الحي قبل الاعتماد.</span>
    </div>}
  </div>;
}
