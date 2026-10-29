'use client';
import {notificationHref} from '@/lib/notification-target';
import {KIND_AR,describeNotification} from '@/lib/notification-presentation';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, Check, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/app-shell';
import { DataState } from '@/components/ui/data-state';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Pagination } from '@/components/ui/primitives';
import { isFinancialAdjustmentEvent } from '@/lib/financial-adjustment';

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
              const desc = describeNotification(n);
              const unread = !n.readAt;
              return (
                <li key={n.id} className={cn('relative flex cursor-pointer items-start gap-3 px-4 py-3.5 hover:bg-concrete-50 dark:hover:bg-white/5', unread && 'bg-pine-50/40 dark:bg-pine-900/15')}>
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
                        <Badge>إشعار</Badge>
                      )}
                      <p className={cn('text-sm', unread ? 'font-semibold text-iron-900 dark:text-concrete-100' : 'text-concrete-600 dark:text-concrete-400')}>
                        {desc.title}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-concrete-600 dark:text-concrete-400">
                      {desc.text}
                    </p>
                    <Link href={notificationHref(n)} onClick={() => { if (unread) readMut.mutate(n.id); }} className="absolute inset-0" aria-label={`فتح ${desc.title}`} />
                    <div className="relative z-10 mt-1.5 flex flex-wrap items-center gap-2 text-xs text-concrete-400">
                      <span>{fmtDateTime(n.createdAt)}</span>
                      {desc.href && (
                        <Link
                          href={notificationHref(n)}
                          className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                        >
                          {isFinancialAdjustmentEvent(n.payload?.event) ? 'عرض الطلب وتفاصيله' : 'عرض العميل'}
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
