'use client';
import {activeNavigationHref} from '@/lib/navigation-match';
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
  Ruler,
  Boxes,
  Activity,
  BadgeDollarSign,
  ClipboardList,
  ScanBarcode,
  UploadCloud,
  Menu,
  X,
} from 'lucide-react';
import { useMe, useCan, useLogout } from '@/lib/auth';
import { api, ApiError, tokenStore } from '@/lib/api';
import { cn } from '@/lib/utils';
import { brandingFromOrganization, OrganizationBrandSource } from '@/lib/branding';
import { BrandLogo } from '@/components/brand';
import { Breadcrumb } from '@/components/breadcrumb';
import { UserMenu } from '@/components/user-menu';
import { NotificationsMenu } from '@/components/notifications-menu';
import { CommandPalette } from '@/components/command-palette';

  const NAV = [
    { href: '/hr', label: 'الموارد البشرية', icon: Users, perm: 'hr.read' },
    { href: '/hr/payroll', label: 'كشف الرواتب الشهري', icon: Users, perm: 'hr.payroll.read' },
  { href: '/hr/employees', label: 'الموظفون والرواتب', icon: Users, perm: 'hr.read' },
  { href: '/hr/requests', label: 'طلبات السلف والإجازات', icon: Users, perm: 'hr.requests.review' },
  { href: '/hr/attendance', label: 'الحضور والانصراف', icon: Users, perm: 'hr.attendance.read' },
  { href: '/hr/tasks', label: 'مهام الموظفين', icon: Users, perm: 'hr.tasks.manage' },
  { href: '/campaigns', label: 'حملات التحصيل', icon: MessageCircle, perm: 'tasks.manage' },
  { href: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, perm: 'reports.read' },
  { href: '/tasks', label: 'عمل اليوم', icon: ListTodo, perm: 'tasks.manage' },
  { href: '/customers', label: 'العملاء', icon: Users, perm: 'customers.read' },
  { href: '/sales-order-drafts', label: 'طلبات العملاء', icon: ClipboardList, perm: 'sales_order_drafts.read' },
  { href: '/quotations', label: 'عروض الأسعار', icon: ClipboardList, perm: 'sales_order_drafts.read' },
  { href: '/advances', label: 'السلف', icon: Banknote, perm: 'customers.read' },
  { href: '/followups', label: 'المتابعات', icon: PhoneCall, perm: 'customers.read' },
  { href: '/promises', label: 'وعود السداد', icon: CalendarClock, perm: 'customers.read' },
  { href: '/collections', label: 'التحصيلات', icon: HandCoins, perm: 'customers.read' },
  { href: '/collections/reconciliation', label: 'مطابقة الصندوق', icon: ClipboardCheck, perm: 'collections.approve' },
  { href: '/imports', label: 'استيراد Excel', icon: FileSpreadsheet, perm: 'imports.read' },
  { href: '/reservations', label: 'حجوزات البضاعة', icon: PackageCheck, perm: 'reservations.read' },
  { href: '/inventory', label: 'المخزون', icon: Boxes, perm: 'inventory.read' },
  { href: '/inventory/barcodes', label: 'تصميم وطباعة الباركود', icon: ScanBarcode, perm: 'inventory.read' },
  { href: '/inventory-transfers', label: 'التحويلات المخزنية', icon: ArrowRightLeft, perm: 'inventory_transfers.read' },
  { href: '/reports', label: 'التقارير', icon: ChartPie, perm: 'reports.read' },
  { href: '/reports/aging', label: 'أعمار الديون', icon: ChartNoAxesColumnIncreasing, perm: 'reports.read' },
  { href: '/reports/kpi', label: 'مؤشرات التحصيل', icon: Gauge, perm: 'reports.read' },
] as const;

  const NAV_ORDER = [
    '/hr',
    '/hr/payroll',
  '/hr/employees',
  '/hr/requests',
  '/hr/attendance',
  '/hr/tasks',
  '/dashboard', '/tasks', '/customers', '/sales-order-drafts', '/quotations', '/followups', '/promises', '/collections',
  '/campaigns', '/advances', '/collections/reconciliation', '/inventory', '/inventory/barcodes', '/inventory-transfers', '/reservations',
  '/reports', '/reports/aging', '/reports/kpi', '/imports',
] as const;

const ADMIN_NAV = [
  { href: '/admin/financial-adjustments', label: 'طلبات الخصم والتصفية', icon: BadgeDollarSign, perm: 'customers.write' },
  { href: '/admin/oracle-test-requests', label: 'عمليات ONYX', icon: ScrollText, perms: [
    'oracle_test_requests.purchase.read', 'oracle_test_requests.purchase.create',
    'oracle_test_requests.receipt.read', 'oracle_test_requests.receipt.create',
    'oracle_test_requests.payment.read', 'oracle_test_requests.payment.create',
    'oracle_test_requests.journal.read', 'oracle_test_requests.journal.create',
    'inventory_transfers.read',
  ] },
  { href: '/admin/oracle-inventory-counts', label: 'مسودات الجرد', icon: ClipboardCheck, perms: [
    'oracle_test_requests.inventory_count.read', 'oracle_test_requests.inventory_count.dry_run',
    'oracle_test_requests.inventory_count.create',
  ] },
  { href: '/admin/credit-control', label: 'الرقابة الائتمانية', icon: ShieldCheck, perm: 'customers.read' },
  { href: '/admin/units', label: 'وحدات الحجوزات', icon: Ruler, perm: 'reservations.manage' },
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
  { href: '/admin/oracle-monitoring', label: 'مراقبة ربط Oracle', icon: Activity, perm: 'settings.manage' },
  { href: '/admin/device-monitoring', label: 'مراقبة الأجهزة والاتصال', icon: Activity, perm: 'settings.manage' },
  { href: '/admin/mobile-releases', label: 'تحديث تطبيق الهاتف', icon: UploadCloud, perm: 'settings.manage' },
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
  useEffect(() => {
    if (sessionStorage.getItem('albinaa.mobile') === '1') document.documentElement.dataset.mobileEmbed = 'true';
    return () => { delete document.documentElement.dataset.mobileEmbed; };
  }, []);
  const router = useRouter();
  const pathname = usePathname();
  // Prevent SSR/client hydration mismatch: server has no localStorage token,
  // client may have one. First paint must match on both sides (LoadingShell).
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileMenuOpen]);

  const { data: me, isLoading, isError, error, refetch, isFetching } = useMe();
  const can = useCan();
  const logout = useLogout();
  const organization = useQuery<OrganizationBrandSource>({
    queryKey: ['organization'],
    queryFn: () => api<OrganizationBrandSource>('/organizations/current'),
    enabled: !!tokenStore.access,
  });
  const branding = brandingFromOrganization(organization.data);
  const configuredIdleMinutes = Number(organization.data?.systemSettings?.find((item) => item.key === 'session.timeout')?.value ?? 60);
  const idleMinutes = Number.isFinite(configuredIdleMinutes) && configuredIdleMinutes > 0 ? configuredIdleMinutes : 60;
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

  useEffect(() => {
    if (!mounted || !tokenStore.access) return;
    const key = 'albinaa.lastActivity';
    let lastWrite = 0;
    const markActivity = () => {
      const now = Date.now();
      if (now - lastWrite < 15_000) return;
      lastWrite = now;
      localStorage.setItem(key, String(now));
    };
    // A successful app mount starts a fresh idle window; stale values from an
    // earlier signed-out user must never close a newly created session.
    markActivity();
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));
    const timer = window.setInterval(() => {
      const last = Number(localStorage.getItem(key) ?? Date.now());
      if (Date.now() - last >= idleMinutes * 60_000) void logout();
    }, 15_000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(timer);
    };
  }, [idleMinutes, logout, mounted]);

  // Same tree on server and first client paint — avoids React #418/#423
  if (!mounted) return <LoadingShell />;

  const nav = NAV.filter((n) => n.href==='/dashboard' ? ['reports.read','tasks.manage','inventory.read','reservations.read','hr.read','hr.requests.review','hr.attendance.read','hr.tasks.manage','hr.payroll.read','sales_order_drafts.read'].some(can) : can(n.perm)).sort((a, b) => NAV_ORDER.indexOf(a.href) - NAV_ORDER.indexOf(b.href));
  const navSections = [
      { label: 'الموارد البشرية', hrefs: ['/hr', '/hr/employees', '/hr/payroll', '/hr/requests', '/hr/attendance', '/hr/tasks'] },
    { label: 'العمل والتحصيل', hrefs: ['/dashboard', '/tasks', '/customers', '/followups', '/promises', '/collections', '/campaigns', '/advances', '/collections/reconciliation'] },
    { label: 'المخزون والطلبات', hrefs: ['/sales-order-drafts', '/quotations', '/inventory', '/inventory/barcodes', '/inventory-transfers', '/reservations'] },
    { label: 'التقارير والبيانات', hrefs: ['/reports', '/reports/aging', '/reports/kpi', '/imports'] },
  ].map((section) => ({ ...section, items: nav.filter((item) => section.hrefs.includes(item.href)) }))
    .filter((section) => section.items.length > 0);
  const adminNav = ADMIN_NAV.filter((n) => 'perms' in n ? n.perms.some((permission) => can(permission)) : can(n.perm));

  const activeHref=activeNavigationHref(pathname,[...nav,...adminNav].map(n=>n.href));
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
    <div className="app-shell min-h-screen bg-surface-0 text-ink-hi lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-l border-line bg-surface-1 text-ink-hi lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <BrandLogo className="h-9 w-9" src={branding.logoDataUrl} name={branding.name} />
          <div>
            <p className="font-display text-sm font-bold leading-tight">{branding.name}</p>
            <p className="text-[11px] text-white/60">{branding.subtitle}</p>
          </div>
        </div>
        <nav aria-label="التنقل الرئيسي" className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {navSections.map((section) => <div key={section.label} className="space-y-0.5">
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-white/45">{section.label}</p>
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = activeHref === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-10 items-center gap-3 rounded-lg border-r-[3px] border-transparent px-3 py-2 text-sm text-ink-mid hover:bg-surface-2 hover:text-ink-hi',
                    active && 'border-brand bg-surface-2 text-ink-hi shadow-glow',
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                  <span className="flex-1">{label}</span>
                  {badgeFor(href) !== undefined && <span className="tnum min-w-5 rounded-full bg-brand px-1.5 py-0.5 text-center text-[10px] font-bold text-surface-0">{badgeFor(href)! > 99 ? '99+' : badgeFor(href)}</span>}
                </Link>
              );
            })}
          </div>)}
          {adminNav.length > 0 && (
            <>
              <div className="my-2 border-t border-white/10" />
              <p className="px-3 pb-1 pt-1 text-[11px] font-medium text-white/40">الإدارة</p>
              {adminNav.map(({ href, label, icon: Icon }) => {
                const active = activeHref === href;
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

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-surface-0 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-3 lg:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="فتح جميع القوائم"
                aria-expanded={mobileMenuOpen}
                className="rounded-lg border border-line p-2 hover:bg-surface-2"
              >
                <Menu className="h-5 w-5" />
              </button>
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

        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="قائمة التنقل">
            <button type="button" aria-label="إغلاق القائمة" onClick={() => setMobileMenuOpen(false)} className="absolute inset-0 bg-black/55" />
            <aside className="absolute inset-y-0 right-0 flex w-[88vw] max-w-sm flex-col border-l border-line bg-surface-1 shadow-2xl">
              <div className="flex items-center justify-between border-b border-line px-4 py-4">
                <div className="flex items-center gap-2.5"><BrandLogo className="h-9 w-9" src={branding.logoDataUrl} name={branding.name} /><div><p className="font-display text-sm font-bold">{branding.name}</p><p className="text-[11px] text-ink-mid">جميع القوائم</p></div></div>
                <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="إغلاق القائمة" className="rounded-lg p-2 hover:bg-surface-2"><X className="h-5 w-5" /></button>
              </div>
              <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {navSections.map((section) => <section key={section.label}>
                  <p className="px-3 pb-1 text-[11px] font-semibold text-ink-low">{section.label}</p>
                  <div className="space-y-1">{section.items.map(({ href, label, icon: Icon }) => {
                    const active = activeHref === href;
                    return <Link key={href} href={href} aria-current={activeHref === href ? 'page' : undefined} onClick={() => setMobileMenuOpen(false)} className={cn('flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm text-ink-mid hover:bg-surface-2', active && 'bg-pine-50 font-bold text-pine-700 dark:bg-pine-900/30 dark:text-pine-100')}><Icon className="h-5 w-5" /><span className="flex-1">{label}</span>{badgeFor(href) !== undefined && <span className="tnum min-w-6 rounded-full bg-brand px-1.5 py-0.5 text-center text-[10px] font-bold text-surface-0">{badgeFor(href)! > 99 ? '99+' : badgeFor(href)}</span>}</Link>;
                  })}</div>
                </section>)}
                {adminNav.length > 0 && <section className="border-t border-line pt-3"><p className="px-3 pb-1 text-[11px] font-semibold text-ink-low">الإدارة</p><div className="space-y-1">{adminNav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className={cn('flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm text-ink-mid hover:bg-surface-2', activeHref === href && 'bg-pine-50 font-bold text-pine-700 dark:bg-pine-900/30 dark:text-pine-100')}><Icon className="h-5 w-5" />{label}</Link>)}</div></section>}
              </nav>
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-5 pb-24 lg:px-6 lg:pb-8">{children}</main>

        <nav
          aria-label="التنقل السريع"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface-1 lg:hidden"
        >
          {['/dashboard', '/tasks']
            .map((href) => nav.find((item) => item.href === href))
            .filter((n): n is NonNullable<typeof n> => !!n)
            .map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={activeHref === href ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px]',
                activeHref === href ? 'text-pine-700 dark:text-pine-100' : 'text-concrete-500',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </Link>
          ))}
          {can('oracle_test_requests.receipt.create') ? (
            <Link
              href="/collections?new=1"
              aria-label="تحصيل"
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
