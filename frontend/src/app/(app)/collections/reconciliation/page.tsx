'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileCheck2, LockKeyhole, Printer, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Empty } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

interface Candidate {
  id: string; amount: number | string; currencyCode: string; collectedAt: string; receiptNumber: string | null;
  collectorId: string; branchId: string | null;
  customer: { name: string; externalCustomerCode: string };
  collector: { user: { fullName: string } }; branch: { name: string } | null; method: { name: string };
}
interface Voucher {
  id: string; serialNumber: string; currencyCode: string; totalAmount: number | string; status: string; createdAt: string;
  branch: { name: string }; collector: { user: { fullName: string } };
  creator: { fullName: string }; matcher: { fullName: string } | null; approver: { fullName: string } | null;
  items: { amount: number | string; collection: Candidate }[];
}
interface ReversalRequest {
  id: string; reason: string; requestedAt: string;
  requester: { fullName: string };
  collection: { id: string; amount: number | string; currencyCode: string; receiptNumber: string | null; customer: { name: string } };
}
interface Board { candidates: Candidate[]; vouchers: Voucher[]; pendingReversals: ReversalRequest[]; legacyWithoutBranch: number }

const voucherTone: Record<string, 'hazard' | 'credit' | 'pine'> = {
  submitted: 'hazard', matched: 'credit', locked: 'pine',
};
const voucherLabel: Record<string, string> = { submitted: 'بانتظار المطابقة', matched: 'مطابقة', locked: 'معتمدة ومقفلة' };

export default function CollectionReconciliationPage() {
  const can = useCan();
  const canApprove = can('collections.approve');
  const canReceive = can('cash.receive');
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [printId, setPrintId] = useState<string | null>(null);
  const board = useQuery<Board>({
    queryKey: ['collection-reconciliation'],
    queryFn: () => api('/collections/reconciliation'), enabled: canApprove,
  });
  const anchor = board.data?.candidates.find((row) => selected.includes(row.id));
  const compatible = (row: Candidate) => !anchor || (
    row.collectorId === anchor.collectorId && row.branchId === anchor.branchId && row.currencyCode === anchor.currencyCode
  );
  const selectedRows = useMemo(
    () => (board.data?.candidates ?? []).filter((row) => selected.includes(row.id)),
    [board.data?.candidates, selected],
  );
  const total = selectedRows.reduce((sum, row) => sum + Number(row.amount), 0);

  const refresh = async () => {
    setSelected([]);
    await qc.invalidateQueries({ queryKey: ['collection-reconciliation'] });
    await qc.invalidateQueries({ queryKey: ['collections'] });
  };
  const createVoucher = useMutation({
    mutationFn: () => api('/collections/reconciliation/vouchers', {
      method: 'POST', body: JSON.stringify({ collectionIds: selected }),
    }),
    onSuccess: async () => { toast('تم إنشاء قسيمة التسليم', 'ok'); await refresh(); },
    onError: (error) => toast(error instanceof Error ? error.message : 'تعذر إنشاء القسيمة', 'err'),
  });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(path, {
      method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    onSuccess: async () => { toast('تم تنفيذ الإجراء', 'ok'); await refresh(); },
    onError: (error) => toast(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء', 'err'),
  });

  useEffect(() => {
    if (!printId) return;
    const timer = window.setTimeout(() => { window.print(); setPrintId(null); }, 100);
    return () => window.clearTimeout(timer);
  }, [printId]);

  if (!canApprove) return <PermissionNotice message="تحتاج صلاحية اعتماد التحصيلات لفتح مطابقة الصندوق." />;
  return (
    <div className="space-y-6">
      <PageHeader title="مطابقة تسليم الصندوق" />
      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .cash-voucher-print, .cash-voucher-print * { visibility: visible !important; }
          .cash-voucher-print { position: fixed; inset: 0 auto auto 0; width: 80mm; padding: 5mm; color: #000; background: #fff; }
        }
      `}</style>
      <DataState
        isLoading={board.isLoading} isError={board.isError} error={board.error}
        onRetry={() => board.refetch()} isFetching={board.isFetching} isEmpty={false} emptyTitle=""
      >
        {board.data && <>
          {board.data.legacyWithoutBranch > 0 && <Card className="border-r-4 border-r-hazard-500 p-4">
            <p className="text-sm font-medium">يوجد {board.data.legacyWithoutBranch} تحصيل قديم بلا فرع، لذلك استُبعد من القسائم المتسلسلة. راجع بياناته قبل التسليم.</p>
          </Card>}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-concrete-100 p-4 dark:border-white/10">
              <div>
                <h2 className="font-display font-bold">التحصيلات الجاهزة للتسليم</h2>
                <p className="mt-1 text-xs text-concrete-500">اختر تحصيلات محصل وفرع وعملة واحدة؛ لا يمكن خلط العملات.</p>
              </div>
              <div className="flex items-center gap-3">
                {selectedRows.length > 0 && <strong dir="ltr">{fmtMoney(total)} {anchor?.currencyCode}</strong>}
                <Button disabled={selected.length === 0} loading={createVoucher.isPending} onClick={() => createVoucher.mutate()}>
                  <FileCheck2 className="h-4 w-4" /> إنشاء قسيمة ({selected.length})
                </Button>
              </div>
            </div>
            {board.data.candidates.length === 0 ? <Empty title="لا توجد تحصيلات مسجلة بانتظار التسليم" /> : (
              <Table>
                <THead cols={['', 'الإيصال', 'العميل', 'المحصل', 'الفرع', 'الطريقة', 'التاريخ', 'المبلغ']} />
                <tbody>{board.data.candidates.map((row) => {
                  const disabled = !compatible(row) && !selected.includes(row.id);
                  return <TRow key={row.id}>
                    <TD><input type="checkbox" aria-label={`اختيار ${row.receiptNumber}`} checked={selected.includes(row.id)} disabled={disabled}
                      onChange={(event) => setSelected((items) => event.target.checked ? [...items, row.id] : items.filter((id) => id !== row.id))} /></TD>
                    <TD><span dir="ltr">{row.receiptNumber ?? '—'}</span></TD><TD>{row.customer.name}</TD>
                    <TD>{row.collector.user.fullName}</TD><TD>{row.branch?.name ?? '—'}</TD><TD>{row.method.name}</TD>
                    <TD>{fmtDateTime(row.collectedAt)}</TD><TD><strong dir="ltr">{fmtMoney(Number(row.amount))} {row.currencyCode}</strong></TD>
                  </TRow>;
                })}</tbody>
              </Table>
            )}
          </Card>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold">قسائم التسليم</h2>
            {board.data.vouchers.length === 0 ? <Empty title="لا توجد قسائم بعد" /> : board.data.vouchers.map((voucher) => (
              <div key={voucher.id} className={printId === voucher.id ? 'cash-voucher-print' : ''}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><div className="flex items-center gap-2"><h3 className="font-display font-bold" dir="ltr">{voucher.serialNumber}</h3>
                    <Badge tone={voucherTone[voucher.status]}>{voucherLabel[voucher.status]}</Badge></div>
                    <p className="mt-2 text-sm">{voucher.branch.name} · {voucher.collector.user.fullName}</p>
                    <p className="text-xs text-concrete-500">أنشأها {voucher.creator.fullName} · {fmtDateTime(voucher.createdAt)}</p>
                  </div>
                  <div className="text-left"><strong className="tnum text-xl" dir="ltr">{fmtMoney(Number(voucher.totalAmount))} {voucher.currencyCode}</strong>
                    <p className="text-xs text-concrete-500">{voucher.items.length} تحصيل</p></div>
                </div>
                <div className="mt-4 divide-y divide-concrete-100 border-y border-concrete-100 text-sm dark:divide-white/10 dark:border-white/10">
                  {voucher.items.map((item) => <div key={item.collection.id} className="flex justify-between py-2">
                    <span>{item.collection.customer.name} · <span dir="ltr">{item.collection.receiptNumber}</span></span>
                    <span dir="ltr">{fmtMoney(Number(item.amount))} {voucher.currencyCode}</span>
                  </div>)}
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2 print:hidden">
                  <Button variant="secondary" onClick={() => setPrintId(voucher.id)}><Printer className="h-4 w-4" /> طباعة 80مم</Button>
                  {voucher.status === 'submitted' && canReceive && <Button onClick={() => action.mutate({ path: `/collections/reconciliation/vouchers/${voucher.id}/match` })}>
                    <CheckCircle2 className="h-4 w-4" /> مطابقة الصندوق</Button>}
                  {voucher.status === 'matched' && <Button onClick={() => action.mutate({ path: `/collections/reconciliation/vouchers/${voucher.id}/lock` })}>
                    <LockKeyhole className="h-4 w-4" /> اعتماد وقفل</Button>}
                </div>
                </Card>
              </div>
            ))}
          </section>

          <Card>
            <div className="border-b border-concrete-100 p-4 dark:border-white/10"><h2 className="font-display font-bold">طلبات العكس المعلقة</h2>
              <p className="mt-1 text-xs text-concrete-500">لا يستطيع منشئ الطلب اعتماده؛ يلزم مستخدم ثانٍ.</p></div>
            {board.data.pendingReversals.length === 0 ? <Empty title="لا توجد طلبات عكس معلقة" /> : (
              <div className="divide-y divide-concrete-100 dark:divide-white/10">{board.data.pendingReversals.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div><p className="font-medium">{request.collection.customer.name} · <span dir="ltr">{request.collection.receiptNumber}</span></p>
                    <p className="text-sm text-concrete-600">{request.reason}</p><p className="text-xs text-concrete-500">طلبه {request.requester.fullName} · {fmtDateTime(request.requestedAt)}</p></div>
                  <div className="flex gap-2"><Button variant="danger" onClick={() => action.mutate({ path: `/collections/reconciliation/reversal-requests/${request.id}/review`, body: { approve: false, note: 'مرفوض من شاشة المطابقة' } })}>
                    <RotateCcw className="h-4 w-4" /> رفض</Button>
                    <Button onClick={() => action.mutate({ path: `/collections/reconciliation/reversal-requests/${request.id}/review`, body: { approve: true } })}>اعتماد العكس</Button></div>
                </div>
              ))}</div>
            )}
          </Card>
        </>}
      </DataState>
    </div>
  );
}
