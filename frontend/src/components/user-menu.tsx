'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLogout, type Me } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

const THEME_OPTIONS = [
  { value: 'light' as const, label: 'فاتح', icon: Sun },
  { value: 'dark' as const, label: 'داكن', icon: Moon },
  { value: 'system' as const, label: 'حسب النظام', icon: Monitor },
];

export function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logout = useLogout();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-concrete-100 dark:hover:bg-white/10"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pine-700 text-sm font-bold text-white">
          {me.fullName.trim().charAt(0)}
        </span>
        <span className="hidden text-right text-sm sm:block">
          <span className="block font-medium leading-tight">{me.fullName}</span>
          <span className="block text-xs text-concrete-500 leading-tight">{me.roles[0] ?? ''}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-concrete-200 bg-white py-1.5 shadow-card dark:border-white/10 dark:bg-iron-800"
        >
          <div className="border-b border-concrete-100 px-3.5 py-2.5 dark:border-white/10">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <UserRound className="h-3.5 w-3.5 text-concrete-500" aria-hidden />
              {me.fullName}
            </p>
            <p className="mt-0.5 text-xs text-concrete-500">{me.roles.join('، ')}</p>
          </div>

          <div className="px-3.5 py-2">
            <p className="mb-1.5 text-xs text-concrete-500">المظهر</p>
            <div className="flex gap-1">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  role="menuitemradio"
                  aria-checked={theme === value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px]',
                    theme === value
                      ? 'bg-pine-50 text-pine-700 dark:bg-pine-900 dark:text-pine-100'
                      : 'text-concrete-500 hover:bg-concrete-100 dark:hover:bg-white/10',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                  {theme === value && <Check className="h-2.5 w-2.5" aria-hidden />}
                </button>
              ))}
            </div>
          </div>

          <button
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2 border-t border-concrete-100 px-3.5 py-2.5 text-sm text-debt-600 hover:bg-debt-50 dark:border-white/10 dark:hover:bg-debt-700/20"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            تسجيل الخروج
          </button>
        </div>
      )}
    </div>
  );
}
