'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, CheckCircle2, CircleX, FileText, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button, Card, Field, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { financialAdjustmentDecisionAr, financialAdjustmentTypeAr } from '@/lib/financial-adjustment';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

type RequestStatus = 'pending' | 'approved' | 'rejected';
type Decision = 'approved' | 'rejected';

interface FinancialAdjustmentRequest {
  id: string;
  requestType: 'discount' | 'settlement';
  currencyCode: string;
  requestedAmount: number | string;
  reason: string;
  status: RequestStatus;
  reviewNotes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  customer: { id: string; name: string; externalCustomerCode: string };
  requester: { id: string; fullName: string };
  reviewer: { id: string; fullName: string } | null;
  journalDraft: Record<string, unknown> | null;
  journalStatus: string | null;
}

const STATUS_TABS: Array<{ value: RequestStatus; label: string }> = [
  { value: 'pending', label: 'بانتظار المراجعة' },
  { value: 'approved', label: 'المعتمدة' },
  { value: 'rejected', label: 'المرفوضة' },
];

export default function FinancialAdjustmentsPage() {
  const can = useCan();
  const allowed = can('customers.write');
  const canCreateJournal = can('oracle_test_requests.journal.create');
  const params = useSearchParams();
  const focusedRequestId = params.get('requestId');
  const requestedStatus = params.get('status');
  const initialStatus = STATUS_TABS.some((tab) => tab.value === requestedStatus)
    ? requestedStatus as RequestStatus
    : 'pending';
  const [status, setStatus] = useState<RequestStatus>(initialStatus);
  const [reviewing, setReviewing] = useState<FinancialAdjustmentRequest | null>(null);
  const [decision, setDecision] = useState<Decision>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => setStatus(initialStatus), [initialStatus]);

  const query = useQuery<FinancialAdjustmentRequest[]>({
    queryKey: ['financial-adjustment-requests', status],
    queryFn: () => api(`/customers/financial-adjustment-requests?status=${status}`),
    enabled: allowed,
    refetchInterval: status === 'pending' ? 30_000 : false,
  });

  const review = useMutation({
    mutationFn: () => api(`/customers/financial-adjustment-requests/${reviewing!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, reviewNotes: reviewNotes.trim() || undefined }),
    }),
    onSuccess: async () => {
      toast(decision === 'approved' ? 'تم الاعتماد وفحص وإنشاء مسودة القيد في Oracle دون ترحيلها' : 'تم رفض الطلب وتوثيق القرار', 'ok');
      setReviewing(null);
      setReviewNotes('');
      await queryClient.invalidateQueries({ queryKey: ['financial-adjustment-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications-preview'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });

  if (!allowed) {
    return <Card><PermissionNotice message="لا تملك صلاحية مراجعة طلبات الخصم والتصفية" /></Card>;
  }

  const items = query.data ?? [];
  const openReview = (item: FinancialAdjustmentRequest, nextDecision: Decision) => {
    setReviewing(item);
    setDecision(nextDecision);
    setReviewNotes('');
  };

  return (
    <div className="space-y-5">
      <PageHeader title="طلبات الخصم والتصفية" />

      <Card className="border-r-4 border-r-pine-600 p-4 text-sm">
        عند الاعتماد يُفحص الحساب والعملة ثم تُنشأ مسودة قيد متوازنة في Oracle: الحساب 312401001 مدين، وحساب العميل دائن. تبقى المسودة غير مرحلة وخاضعة لاعتماد Oracle.
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="حالة الطلبات">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.value}
              role="tab"
              aria-selected={status === tab.value}
              variant={status === tab.value ? 'primary' : 'secondary'}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </Card>

      <DataState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        isFetching={query.isFetching}
        isEmpty={!items.length}
        emptyTitle="لا توجد طلبات في هذه الحالة"
        emptyHint="ستظهر الطلبات هنا فور إرسالها من التطبيق"
        skeletonClassName="h-64"
      >
        <div className="grid gap-3">
          {items.map((item) => {
            const focused = focusedRequestId === item.id;
            const pending = item.status === 'pending';
            return (
              <Card
                key={item.id}
                className={cn('overflow-hidden', focused && 'ring-2 ring-hazard-500 ring-offset-2')}
              >
                <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <BadgeDollarSign className="h-5 w-5 text-hazard-600" aria-hidden />
                      <Badge tone={item.requestType === 'discount' ? 'hazard' : 'debt'}>
                        طلب {financialAdjustmentTypeAr(item.requestType)}
                      </Badge>
                      <Badge tone={item.status === 'approved' ? 'pine' : item.status === 'rejected' ? 'debt' : 'neutral'}>
                        {financialAdjustmentDecisionAr(item.status)}
                      </Badge>
                      {focused && <Badge tone="hazard">الطلب المحدد من الإشعار</Badge>}
                    </div>

                    <div>
                      <Link href={`/customers/${item.customer.id}`} className="text-lg font-bold text-pine-700 hover:underline dark:text-pine-100">
                        {item.customer.name}
                      </Link>
                      <p className="tnum text-xs text-concrete-500" dir="ltr">{item.customer.externalCustomerCode}</p>
                    </div>

                    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div><dt className="text-xs text-concrete-500">المبلغ المطلوب</dt><dd className="tnum font-bold" dir="ltr">{fmtMoney(Number(item.requestedAmount))} {item.currencyCode}</dd></div>
                      <div><dt className="text-xs text-concrete-500">مقدم الطلب</dt><dd className="flex items-center gap-1 font-medium"><UserRound className="h-4 w-4" />{item.requester.fullName}</dd></div>
                      <div><dt className="text-xs text-concrete-500">وقت الطلب</dt><dd>{fmtDateTime(item.createdAt)}</dd></div>
                      {item.reviewer && <div><dt className="text-xs text-concrete-500">المراجع</dt><dd>{item.reviewer.fullName}</dd></div>}
                    </dl>

                    <div className="rounded-lg bg-concrete-50 p-3 text-sm dark:bg-white/5">
                      <p className="text-xs font-semibold text-concrete-500">سبب الطلب</p>
                      <p className="mt-1 whitespace-pre-wrap">{item.reason}</p>
                    </div>
                    {item.reviewNotes && (
                      <div className="rounded-lg border border-line p-3 text-sm">
                        <p className="text-xs font-semibold text-concrete-500">ملاحظات القرار</p>
                        <p className="mt-1 whitespace-pre-wrap">{item.reviewNotes}</p>
                      </div>
                    )}
                  </div>

                  {pending && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="success" disabled={!canCreateJournal} title={!canCreateJournal ? 'يلزم منح صلاحية إنشاء مسودة قيد يومي' : undefined} onClick={() => openReview(item, 'approved')}>
                        <CheckCircle2 className="h-4 w-4" />اعتماد
                      </Button>
                      <Button variant="danger" onClick={() => openReview(item, 'rejected')}>
                        <CircleX className="h-4 w-4" />رفض
                      </Button>
                    </div>
                  )}
                  {!pending && item.status === 'approved' && item.journalDraft && canCreateJournal && (
                    <Link href="/admin/oracle-test-requests" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-pine-700 px-4 py-2 text-sm font-bold text-white hover:bg-pine-800">
                      <FileText className="h-4 w-4" />عرض القيد المنشأ في عمليات ONYX
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </DataState>

      <Dialog
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title={`${decision === 'approved' ? 'اعتماد' : 'رفض'} طلب ${financialAdjustmentTypeAr(reviewing?.requestType)}`}
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-concrete-50 p-3 text-sm dark:bg-white/5">
            <p className="font-bold">{reviewing?.customer.name}</p>
            <p className="tnum mt-1" dir="ltr">{reviewing ? `${fmtMoney(Number(reviewing.requestedAmount))} ${reviewing.currencyCode}` : ''}</p>
          </div>
          {decision === 'approved' && <div className="rounded-lg border border-pine-600/25 bg-pine-50 p-3 text-sm text-pine-800 dark:bg-pine-900/20 dark:text-pine-100">سيُفحص ويُنشأ فورًا كمسودة غير مرحلة: 312401001 مدين ← حساب العميل دائن، بنفس العملة والمبلغ، وبيان «{reviewing?.requestType === 'settlement' ? 'تصفية الحساب' : 'خصم'} - السبب».</div>}
          <Field label={decision === 'rejected' ? 'سبب الرفض (مطلوب)' : 'ملاحظات الاعتماد'}>
            <Textarea rows={4} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="اكتب سبب القرار بوضوح" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReviewing(null)}>إلغاء</Button>
            <Button
              variant={decision === 'approved' ? 'success' : 'danger'}
              loading={review.isPending}
              disabled={decision === 'rejected' && reviewNotes.trim().length < 2}
              onClick={() => review.mutate()}
            >
              تأكيد {decision === 'approved' ? 'الاعتماد' : 'الرفض'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
