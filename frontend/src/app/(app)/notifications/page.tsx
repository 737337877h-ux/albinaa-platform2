'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, Check, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/app-shell';
import { DataState } from '@/components/ui/data-state';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Pagination } from '@/components/ui/primitives';

/* ────────────────────────────── Types ────────────────────────────────── */

interface NotificationItem {
  id: string;
  kind: string;
  readAt: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

interface NotificationsResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unread: number;
  items: NotificationItem[];
}

/* ────────────────────────────── Helpers ──────────────────────────────── */

type KindTone = 'neutral' | 'pine' | 'hazard' | 'debt';

const KIND_AR: Record<string, { label: string; tone: KindTone }> = {
  promise_due: { label: 'وعد مستحق', tone: 'hazard' },
  promise_overdue: { label: 'وعد متأخر', tone: 'debt' },
  collection_created: { label: 'تحصيل جديد', tone: 'pine' },
  collection_reversal_requested: { label: 'طلب عكس تحصيل', tone: 'debt' },
  finance_alert: { label: 'تنبيه مالي فوري', tone: 'debt' },
  scheduled_job_failed: { label: 'فشل مهمة مجدولة', tone: 'debt' },
  customer_transferred: { label: 'نقل عميل', tone: 'neutral' },
};

function describe(n: NotificationItem): { title: string; text: string; href?: string } {
  const p = n.payload ?? {};
  const customerName = (p.customerName as string | undefined) ?? '';
  const money =
    p.amount != null && p.currency
      ? `${fmtMoney(p.amount as number)} ${String(p.currency)}`
      : null;
  const customerHref =
    typeof p.customerId === 'string' && p.customerId ? `/customers/${p.customerId}` : undefined;

  switch (n.kind) {
    case 'promise_due':
      return {
        title: 'تذكير بوعد سداد',
        text: money
          ? `وعد سداد من ${customerName || 'عميل'} بمبلغ ${money}${p.dueDate ? ` — يستحق ${fmtDateTime(p.dueDate as string)}` : ''}`
          : `وعد سداد من ${customerName || 'عميل'} يستحق قريبًا`,
        href: customerHref,
      };
    case 'promise_overdue':
      return {
        title: 'وعد سداد متأخر',
        text: money
          ? `تجاوز ${customerName || 'العميل'} موعد الوفاء بوعد بمبلغ ${money}${p.reason ? ` (${p.reason})` : ''}`
          : `تجاوز ${customerName || 'العميل'} موعد الوفاء بوعد${p.reason ? ` (${p.reason})` : ''}`,
        href: customerHref,
      };
    case 'collection_created':
      return {
        title: 'تحصيل جديد بانتظار الاستلام',
        text: `سُجّل تحصيل من ${customerName || ''}${money ? ` بمبلغ ${money}` : ''}${p.method ? ` — ${p.method}` : ''}${p.collectorName ? ` بواسطة ${p.collectorName}` : ''}`,
        href: customerHref,
      };
    case 'collection_reversal_requested':
      return {
        title: 'طلب عكس يحتاج موافقة مالية',
        text: `طُلب عكس تحصيل${money ? ` بمبلغ ${money}` : ''}${p.reason ? ` — ${p.reason}` : ''}`,
        href: '/collections/reconciliation',
      };
    case 'finance_alert': {
      const labels: Record<string, string> = {
        collection_reversed: 'تم عكس تحصيل',
        manual_balance_adjustment: 'تم تعديل رصيد يدويًا',
        credit_limit_overridden: 'تم تجاوز سقف ائتمان',
        customer_merged: 'تم دمج سجلّي عميل',
        import_reversed: 'تم التراجع عن دفعة استيراد',
      };
      const eventLabel = labels[String(p.event)] ?? 'تمت عملية مالية حساسة';
      return {
        title: eventLabel,
        text: `${eventLabel}${money ? ` بمبلغ ${money}` : ''}${p.actorName ? ` بواسطة ${p.actorName}` : ''}${p.reason ? ` — ${p.reason}` : ''}`,
        href: typeof p.href === 'string' ? p.href : undefined,
      };
    }
    case 'scheduled_job_failed':
      return {
        title: 'تعطلت مهمة مجدولة',
        text: `فشلت المهمة ${p.job ?? ''}${p.message ? ` — ${p.message}` : ''}`,
        href: typeof p.href === 'string' ? p.href : '/admin/audit',
      };
    case 'customer_transferred':
      return {
        title: 'نُقل إليك عميل',
        text: `نُقل إليك العميل ${customerName || ''}${p.customerCode ? ` (${p.customerCode})` : ''}${p.reason ? ` — ${p.reason}` : ''}`,
        href: customerHref,
      };
    default:
      return { title: n.kind, text: '' };
  }
}

/* ────────────────────────────── Page ─────────────────────────────────── */

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const PAGE_SIZE = 25;

  const query = useQuery({
    queryKey: ['notifications', { page, unreadOnly }],
    queryFn: () =>
      api<NotificationsResponse>(
        `/notifications?page=${page}&limit=${PAGE_SIZE}${unreadOnly ? '&unreadOnly=true' : ''}`,
      ),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications-preview'] });
  };

  const readMut = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const readAllMut = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => {
      toast('تم تحديد كل الإشعارات كمقروءة', 'ok');
      invalidate();
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const data = query.data;
  const hasUnread = (data?.unread ?? 0) > 0;

  const toggleUnreadOnly = () => {
    setPage(1);
    setUnreadOnly((v) => !v);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="الإشعارات"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={toggleUnreadOnly}
              className={cn(unreadOnly && 'bg-pine-50 text-pine-700 dark:bg-pine-900/30 dark:text-pine-100')}
            >
              غير المقروءة فقط
              {hasUnread && <span className="tnum text-xs opacity-80">({data?.unread})</span>}
            </Button>
            <Button
              onClick={() => readAllMut.mutate()}
              disabled={!hasUnread}
              loading={readAllMut.isPending}
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              تحديد الكل كمقروء
            </Button>
          </div>
        }
      />

      <DataState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        isFetching={query.isFetching}
        isEmpty={!data?.items?.length}
        emptyTitle={unreadOnly ? 'لا إشعارات غير مقروءة' : 'لا إشعارات بعد'}
        emptyHint={unreadOnly ? 'جرّب عرض كل الإشعارات' : 'ستظهر هنا الإشعارات الجديدة عند صدورها'}
        skeletonClassName="h-64"
      >
        <Card>
          <ul className="divide-y divide-concrete-100 dark:divide-white/10">
            {data?.items.map((n) => {
              const meta = KIND_AR[n.kind];
              const desc = describe(n);
              const unread = !n.readAt;
              return (
                <li key={n.id} className={cn('flex items-start gap-3 px-4 py-3.5', unread && 'bg-pine-50/40 dark:bg-pine-900/15')}>
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      unread ? 'bg-pine-600' : 'bg-transparent ring-1 ring-concrete-300 dark:ring-white/20',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {meta ? (
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      ) : (
                        <Badge>{n.kind}</Badge>
                      )}
                      <p className={cn('text-sm', unread ? 'font-semibold text-iron-900 dark:text-concrete-100' : 'text-concrete-600 dark:text-concrete-400')}>
                        {desc.title}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-concrete-600 dark:text-concrete-400">
                      {desc.text}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-concrete-400">
                      <span>{fmtDateTime(n.createdAt)}</span>
                      {desc.href && (
                        <Link
                          href={desc.href}
                          className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                        >
                          عرض العميل
                        </Link>
                      )}
                    </div>
                  </div>
                  {unread && (
                    <Button
                      variant="ghost"
                      className="shrink-0 px-2 py-1 text-xs"
                      onClick={() => readMut.mutate(n.id)}
                      loading={readMut.isPending && readMut.variables === n.id}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      تحديد كمقروء
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {!data?.items?.length && (
            <div className="flex flex-col items-center gap-2 py-12 text-concrete-300 dark:text-concrete-500">
              <BellOff className="h-8 w-8" aria-hidden />
            </div>
          )}
          <Pagination
            page={data?.page ?? 1}
            totalPages={data?.totalPages ?? 1}
            onPage={setPage}
          />
        </Card>
      </DataState>
    </div>
  );
}
