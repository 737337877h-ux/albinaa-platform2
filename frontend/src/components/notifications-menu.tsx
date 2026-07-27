'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api, tokenStore } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string; kind: string; readAt: string | null; createdAt: string;
  payload: Record<string, unknown>;
}

function describe(n: NotificationItem): string {
  const p = n.payload ?? {};
  switch (n.kind) {
    case 'promise_due': return `تذكير: وعد سداد من ${p.customerName ?? 'عميل'}`;
    case 'promise_overdue': return `وعد متأخر من ${p.customerName ?? 'عميل'}`;
    case 'collection_created': return `تحصيل جديد من ${p.customerName ?? ''}`;
    case 'customer_transferred': return `نُقل إليك العميل ${p.customerName ?? ''}`;
    default: return n.kind;
  }
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['notifications-preview'],
    queryFn: () => api<{ unread: number; items: NotificationItem[] }>('/notifications?limit=6'),
    refetchInterval: 60_000,
    enabled: typeof window !== 'undefined' && !!tokenStore.access,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`الإشعارات${data?.unread ? ` (${data.unread} غير مقروء)` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative rounded-lg p-2 hover:bg-concrete-100 dark:hover:bg-white/10"
      >
        <Bell className="h-5 w-5" />
        {!!data?.unread && (
          <span className="tnum absolute -left-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-debt-600 px-1 text-[10px] font-bold text-white">
            {data.unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-concrete-200 bg-white shadow-card dark:border-white/10 dark:bg-iron-800"
        >
          <div className="border-b border-concrete-100 px-4 py-2.5 text-sm font-medium dark:border-white/10">
            الإشعارات
          </div>
          {data?.items?.length ? (
            <ul className="max-h-80 divide-y divide-concrete-100 overflow-y-auto dark:divide-white/10">
              {data.items.map((n) => (
                <li key={n.id}>
                  <Link
                    href="/notifications"
                    onClick={() => setOpen(false)}
                    className={cn(
                      'block px-4 py-2.5 text-sm hover:bg-concrete-50 dark:hover:bg-white/5',
                      !n.readAt && 'bg-pine-50/50 dark:bg-pine-900/20',
                    )}
                  >
                    <p className={cn(!n.readAt && 'font-medium')}>{describe(n)}</p>
                    <p className="mt-0.5 text-xs text-concrete-400">{fmtDateTime(n.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-concrete-500">لا إشعارات بعد</p>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-concrete-100 px-4 py-2.5 text-center text-xs font-medium text-pine-700 hover:bg-concrete-50 dark:border-white/10 dark:hover:bg-white/5"
          >
            عرض كل الإشعارات
          </Link>
        </div>
      )}
    </div>
  );
}
