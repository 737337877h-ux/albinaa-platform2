'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Banknote, CalendarClock, FileSpreadsheet, HandCoins, LayoutDashboard,
  ListTodo, PhoneCall, Users, Settings, Shield, UserCog, GitBranch,
  CircleDollarSign, ScrollText, ArrowRightLeft, ShieldCheck, Landmark, PackageCheck,
  ChartNoAxesColumnIncreasing,
  ChartPie,
  Gauge,
  ClipboardCheck,
  MessageCircle,
} from 'lucide-react';
import { useMe, useCan } from '@/lib/auth';
import { api, ApiError, tokenStore } from '@/lib/api';
import { cn } from '@/lib/utils';
import { brandingFromOrganization, OrganizationBrandSource } from '@/lib/branding';
import { BrandLogo } from '@/components/brand';
import { Breadcrumb } from '@/components/breadcrumb';
import { UserMenu } from '@/components/user-menu';
import { NotificationsMenu } from '@/components/notifications-menu';
import { CommandPalette } from '@/components/command-palette';

const NAV = [
  { href: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, perm: 'reports.read' },
  { href: '/tasks', label: 'عمل اليوم', icon: ListTodo, perm: 'tasks.manage' },
  { href: '/customers', label: 'العملاء', icon: Users, perm: 'customers.read' },
  { href: '/advances', label: 'السلف', icon: Banknote, perm: 'analytical_accounts.read' },
  { href: '/followups', label: 'المتابعات', icon: PhoneCall, perm: 'customers.read' },
  { href: '/promises', label: 'وعود السداد', icon: CalendarClock, perm: 'customers.read' },
  { href: '/collections', label: 'التحصيلات', icon: HandCoins, perm: 'customers.read' },
  { href: '/collections/reconciliation', label: 'مطابقة الصندوق', icon: ClipboardCheck, perm: 'collections.approve' },
  { href: '/imports', label: 'استيراد Excel', icon: FileSpreadsheet, perm: 'imports.read' },
  { href: '/reservations', label: 'حجوزات البضاعة', icon: PackageCheck, perm: 'reservations.read' },
  { href: '/reports', label: 'التقارير', icon: ChartPie, perm: 'reports.read' },
  { href: '/reports/aging', label: 'أعمار الديون', icon: ChartNoAxesColumnIncreasing, perm: 'reports.read' },
  { href: '/reports/kpi', label: 'مؤشرات التحصيل', icon: Gauge, perm: 'reports.read' },
] as const;

const ADMIN_NAV = [
  { href: '/admin/users', label: 'المستخدمين', icon: UserCog, perm: 'users.manage' },
  { href: '/admin/roles', label: 'الأدوار والصلاحيات', icon: Shield, perm: 'users.manage' },
  { href: '/admin/collectors', label: 'المحصلين', icon: Users, perm: 'users.manage' },
  { href: '/admin/assignments', label: 'الإسناد الجماعي', icon: ArrowRightLeft, perm: 'customers.transfer' },
  { href: '/admin/data-quality', label: 'Data Quality', icon: ShieldCheck, perm: 'duplicates.review' },
  {
    href: '/admin/analytical-accounts',
    label: 'الحسابات التحليلية',
    icon: Landmark,
    perm: 'analytical_accounts.read',
  },
  { href: '/admin/branches', label: 'الفروع', icon: GitBranch, perm: 'settings.manage' },
  { href: '/admin/currencies', label: 'العملات', icon: CircleDollarSign, perm: 'settings.manage' },
  { href: '/admin/settings', label: 'الإعدادات', icon: Settings, perm: 'settings.manage' },
  { href: '/admin/accounting-periods', label: 'الفترات المحاسبية', icon: CalendarClock, perm: 'periods.manage' },
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
  const organization = useQuery<OrganizationBrandSource>({
    queryKey: ['organization'],
    queryFn: () => api<OrganizationBrandSource>('/organizations/current'),
    enabled: !!tokenStore.access,
  });
  const branding = brandingFromOrganization(organization.data);
  const navCounts = useQuery({
    queryKey: ['nav-counts'],
    queryFn: () => api<{ tasks: number; followups: number; promises: number }>('/dashboard/nav-counts'),
    enabled: !!tokenStore.access && can('customers.read'),
    refetchInterval: 60_000,
  });
  const badgeFor = (href: string) => href === '/tasks' ? navCounts.data?.tasks : href === '/followups' ? navCounts.data?.followups : href === '/promises' ? navCounts.data?.promises : undefined;

  const unauthorized = isError && error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (!mounted) return;
    if (!tokenStore.access) router.replace('/login');
  }, [mounted, router]);

  useEffect(() => {
    if (!mounted) return;
    if (unauthorized) router.replace('/login');
  }, [mounted, unauthorized, router]);

  useEffect(() => {
    if (!organization.data) return;
    document.title = `${branding.name} — ${branding.subtitle}`;
  }, [branding.name, branding.subtitle, organization.data]);

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
    <div className="min-h-screen bg-surface-0 text-ink-hi lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-l border-line bg-surface-1 text-ink-hi lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <BrandLogo className="h-9 w-9" src={branding.logoDataUrl} name={branding.name} />
          <div>
            <p className="font-display text-sm font-bold leading-tight">{branding.name}</p>
            <p className="text-[11px] text-white/60">{branding.subtitle}</p>
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
                  'flex min-h-11 items-center gap-3 rounded-lg border-r-[3px] border-transparent px-3 py-2.5 text-sm text-ink-mid hover:bg-surface-2 hover:text-ink-hi',
                  active && 'border-brand bg-surface-2 text-ink-hi shadow-glow',
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
                <span className="flex-1">{label}</span>
                {badgeFor(href) !== undefined && <span className="tnum min-w-5 rounded-full bg-brand px-1.5 py-0.5 text-center text-[10px] font-bold text-surface-0">{badgeFor(href)! > 99 ? '99+' : badgeFor(href)}</span>}
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
                      'flex min-h-11 items-center gap-3 rounded-lg border-r-[3px] border-transparent px-3 py-2.5 text-sm text-ink-mid hover:bg-surface-2 hover:text-ink-hi',
                      active && 'border-brand bg-surface-2 text-ink-hi shadow-glow',
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
          v{process.env.NEXT_PUBLIC_APP_VERSION ?? '1.3.0-rc.1'}
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-surface-0 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-3 lg:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <BrandLogo className="h-8 w-8" src={branding.logoDataUrl} name={branding.name} />
              <span className="font-display text-sm font-bold">{branding.name}</span>
            </div>
            <div className="hidden lg:block">
              <Breadcrumb />
            </div>
            <div className="flex items-center gap-1">
              <CommandPalette />
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
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface-1 lg:hidden"
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
          {can('tasks.manage') ? <Link href="/tasks?channel=whatsapp" className="flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[10px] text-whatsapp"><MessageCircle className="h-5 w-5" aria-hidden />واتساب</Link> : <span />}
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
