'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Banknote, CalendarClock, FileSpreadsheet, HandCoins, LayoutDashboard,
  ListTodo, PhoneCall, Users, Settings, Shield, UserCog, GitBranch,
  CircleDollarSign, ScrollText, ArrowRightLeft, ShieldCheck,
} from 'lucide-react';
import { useMe, useCan } from '@/lib/auth';
import { ApiError, tokenStore } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/brand';
import { Breadcrumb } from '@/components/breadcrumb';
import { UserMenu } from '@/components/user-menu';
import { NotificationsMenu } from '@/components/notifications-menu';

const NAV = [
  { href: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, perm: 'reports.read' },
  { href: '/tasks', label: 'عمل اليوم', icon: ListTodo, perm: 'tasks.manage' },
  { href: '/customers', label: 'العملاء', icon: Users, perm: 'customers.read' },
  { href: '/followups', label: 'المتابعات', icon: PhoneCall, perm: 'customers.read' },
  { href: '/promises', label: 'وعود السداد', icon: CalendarClock, perm: 'customers.read' },
  { href: '/collections', label: 'التحصيلات', icon: HandCoins, perm: 'customers.read' },
  { href: '/imports', label: 'استيراد Excel', icon: FileSpreadsheet, perm: 'imports.read' },
] as const;

const ADMIN_NAV = [
  { href: '/admin/users', label: 'المستخدمين', icon: UserCog, perm: 'users.manage' },
  { href: '/admin/roles', label: 'الأدوار والصلاحيات', icon: Shield, perm: 'users.manage' },
  { href: '/admin/collectors', label: 'المحصلين', icon: Users, perm: 'users.manage' },
  { href: '/admin/assignments', label: 'الإسناد الجماعي', icon: ArrowRightLeft, perm: 'customers.transfer' },
  { href: '/admin/data-quality', label: 'Data Quality', icon: ShieldCheck, perm: 'duplicates.review' },
  { href: '/admin/branches', label: 'الفروع', icon: GitBranch, perm: 'settings.manage' },
  { href: '/admin/currencies', label: 'العملات', icon: CircleDollarSign, perm: 'settings.manage' },
  { href: '/admin/settings', label: 'الإعدادات', icon: Settings, perm: 'settings.manage' },
  { href: '/admin/audit', label: 'سجل العمليات', icon: ScrollText, perm: 'audit.read' },
] as const;

function LoadingShell() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-concrete-500">
      <BrandLogo className="h-6 w-6" />
      جارٍ التحميل…
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Prevent SSR/client hydration mismatch: server has no localStorage token,
  // client may have one. First paint must match on both sides (LoadingShell).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: me, isLoading, isError, error, refetch, isFetching } = useMe();
  const can = useCan();

  const unauthorized = isError && error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (!mounted) return;
    if (!tokenStore.access) router.replace('/login');
  }, [mounted, router]);

  useEffect(() => {
    if (!mounted) return;
    if (unauthorized) router.replace('/login');
  }, [mounted, unauthorized, router]);

  // Same tree on server and first client paint — avoids React #418/#423
  if (!mounted) return <LoadingShell />;

  const nav = NAV.filter((n) => can(n.perm));
  const adminNav = ADMIN_NAV.filter((n) => can(n.perm));

  if (isLoading) return <LoadingShell />;

  if (isError && !unauthorized) {
    const message = error instanceof ApiError
      ? (error.status === 0
          ? 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالشبكة.'
          : 'الخادم يواجه مشكلة مؤقتة. حاول مرة أخرى بعد قليل.')
      : 'حدث خطأ غير متوقع أثناء تحميل بيانات الجلسة.';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <BrandLogo className="h-10 w-10" />
        <p className="max-w-sm text-sm text-debt-600 dark:text-debt-400">{message}</p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800 disabled:opacity-50"
        >
          {isFetching ? 'جارٍ إعادة المحاولة…' : 'إعادة المحاولة'}
        </button>
      </div>
    );
  }

  if (!me) return <LoadingShell />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden bg-iron-900 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <BrandLogo className="h-7 w-7" />
          <div>
            <p className="font-display text-sm font-bold leading-tight">البناء الراقي</p>
            <p className="text-[11px] text-white/60">المديونية والتحصيل</p>
          </div>
        </div>
        <nav aria-label="التنقل الرئيسي" className="flex-1 space-y-0.5 px-3">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/75 hover:bg-white/10 hover:text-white',
                  active && 'bg-pine-700 text-white',
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
                {label}
              </Link>
            );
          })}
          {adminNav.length > 0 && (
            <>
              <div className="my-2 border-t border-white/10" />
              <p className="px-3 pb-1 pt-1 text-[11px] font-medium text-white/40">الإدارة</p>
              {adminNav.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/75 hover:bg-white/10 hover:text-white',
                      active && 'bg-pine-700 text-white',
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                    {label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs text-white/60">
          v1.0.0
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-concrete-200 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-iron-900/90">
          <div className="flex items-center justify-between px-4 py-3 lg:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <BrandLogo className="h-7 w-7" />
              <span className="font-display text-sm font-bold">البناء الراقي</span>
            </div>
            <div className="hidden lg:block">
              <Breadcrumb />
            </div>
            <div className="flex items-center gap-1">
              <NotificationsMenu />
              <UserMenu me={me} />
            </div>
          </div>
          <div className="border-t border-concrete-100 px-4 py-1.5 dark:border-white/10 lg:hidden">
            <Breadcrumb />
          </div>
        </header>

        <main className="flex-1 px-4 py-5 pb-24 lg:px-6 lg:pb-8">{children}</main>

        <nav
          aria-label="التنقل السريع"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-concrete-200 bg-white dark:border-white/10 dark:bg-iron-900 lg:hidden"
        >
          {[NAV[1], NAV[2]].filter((n) => can(n.perm)).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname.startsWith(href) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px]',
                pathname.startsWith(href) ? 'text-pine-700 dark:text-pine-100' : 'text-concrete-500',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </Link>
          ))}
          {can('collections.create') ? (
            <Link
              href="/collections?new=1"
              aria-label="تسجيل تحصيل جديد"
              className="relative -top-4 mx-auto flex h-14 w-14 flex-col items-center justify-center rounded-full bg-pine-700 text-white shadow-lg"
            >
              <Banknote className="h-6 w-6" aria-hidden />
              <span className="text-[9px]">تحصيل</span>
            </Link>
          ) : <span />}
          {[NAV[4], NAV[0]].filter((n) => can(n.perm)).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname.startsWith(href) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px]',
                pathname.startsWith(href) ? 'text-pine-700 dark:text-pine-100' : 'text-concrete-500',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="font-display text-xl font-bold">{title}</h1>
      {action}
    </div>
  );
}
