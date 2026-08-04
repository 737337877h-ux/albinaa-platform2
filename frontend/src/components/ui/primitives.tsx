'use client';
import { cn } from '@/lib/utils';
import { fmtMoney } from '@/lib/format';
import { Inbox, Loader2 } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';

/* ============================== Button ================================== */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-gradient-to-l from-brand to-brand-dim text-surface-0 shadow-glow hover:brightness-110',
  secondary:
    'bg-white border border-concrete-200 text-iron-900 hover:bg-concrete-100 ' +
    'dark:bg-surface-2 dark:border-line dark:text-ink-hi dark:hover:bg-surface-3',
  ghost: 'text-pine-700 hover:bg-pine-50 dark:text-brand dark:hover:bg-surface-2',
  danger: 'bg-debt-600 text-white hover:bg-debt-700',
  success: 'bg-credit-600 text-white hover:bg-credit-700',
};
export const Button = forwardRef<HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }
>(function Button({ className, variant = 'primary', loading, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold',
        'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        btnStyles[variant], className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/* =============================== Inputs ================================= */
const inputBase =
  'min-h-11 w-full rounded-lg border border-concrete-200 bg-white px-3 py-2 text-sm ' +
  'placeholder:text-concrete-400 focus:border-pine-500 ' +
  'dark:border-line dark:bg-surface-3 dark:text-ink-hi dark:placeholder:text-ink-low';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputBase, className)} {...props} />;
  },
);
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(inputBase, className)} {...props}>
        {children}
      </select>
    );
  },
);
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(inputBase, className)} {...props} />;
  },
);

export function Field({ label, error, children, hint, errorId }: {
  label: string; error?: string; hint?: string; errorId?: string; children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-concrete-700 dark:text-concrete-200">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-concrete-500">{hint}</span>}
      {error && (
        <span id={errorId} role="alert" className="block text-xs text-debt-600 dark:text-debt-500">
          {error}
        </span>
      )}
    </label>
  );
}

/* ============================ Card & Badge ============================== */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'ui-card rounded-brand border border-line bg-surface-1 shadow-[var(--shadow-card)] dark:bg-[linear-gradient(135deg,var(--surface-2),var(--surface-1))]',
        className,
      )}
    >
      {children}
    </div>
  );
}
export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-concrete-100 px-4 py-3 dark:border-white/10">
      <h3 className="font-display text-sm font-semibold">{title}</h3>
      {action}
    </div>
  );
}
type BadgeTone = 'neutral' | 'pine' | 'hazard' | 'debt' | 'credit';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-concrete-100 text-concrete-700 dark:bg-white/10 dark:text-concrete-200',
  pine: 'bg-pine-50 text-pine-700 dark:bg-pine-900 dark:text-pine-100',
  hazard: 'bg-hazard-100 text-hazard-700 dark:bg-hazard-700/30 dark:text-hazard-100',
  debt: 'bg-debt-50 text-debt-700 dark:bg-debt-700/30 dark:text-debt-50',
  credit: 'bg-credit-50 text-credit-700 dark:bg-credit-700/30 dark:text-credit-50',
};
export function Badge({ tone = 'neutral', children, className }: {
  tone?: BadgeTone; children: React.ReactNode; className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTones[tone], className,
      )}
    >
      {children}
    </span>
  );
}

export function CurrencyChip({ code }: { code: string }) {
  return <span className="rounded-md border border-line bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold text-ink-mid">{code}</span>;
}

export function RiskBadge({ level, children }: { level: 'low' | 'mid' | 'high' | 'critical'; children?: React.ReactNode }) {
  const colors = { low: 'var(--risk-low)', mid: 'var(--risk-mid)', high: 'var(--risk-high)', critical: 'var(--risk-crit)' };
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold', level === 'critical' && 'critical-glow')} style={{ color: colors[level], borderColor: colors[level], backgroundColor: `color-mix(in srgb, ${colors[level]} 12%, transparent)` }}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children ?? ({ low: 'منخفض', mid: 'متوسط', high: 'مرتفع', critical: 'حرج' }[level])}</span>;
}

function AnimatedValue({ value }: { value: React.ReactNode }) {
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const [shown, setShown] = useState(isNumber ? 0 : value);

  useEffect(() => {
    if (!isNumber) {
      setShown(value);
      return;
    }
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / 600, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isNumber, value]);

  return <>{typeof shown === 'number' ? shown.toLocaleString('en-US') : shown}</>;
}

export function StatCard({ label, value, currency, hint, tone = 'normal', icon }: {
  label: string; value: React.ReactNode; currency?: string; hint?: string;
  tone?: 'normal' | 'money' | 'critical' | 'reservation'; icon?: React.ReactNode;
}) {
  return <Card className={cn('p-4', tone === 'critical' && 'critical-glow', tone === 'reservation' && 'reservation-glow')}>
    <div className="flex items-center justify-between text-xs text-ink-mid"><span>{label}</span>{icon}</div>
    <div className={cn('mt-2 flex items-baseline gap-2 text-[clamp(1.75rem,3vw,2.125rem)] font-extrabold', tone === 'money' ? 'text-gold' : 'text-ink-hi')}><span className="tnum"><AnimatedValue value={value} /></span>{currency && <CurrencyChip code={currency} />}</div>
    {hint && <p className="mt-1 text-xs text-ink-mid">{hint}</p>}
  </Card>;
}

/* ============================ Money display ============================= */
export function Money({ value, currency, signed = false }: {
  value: number | string | null | undefined; currency?: string; signed?: boolean;
}) {
  const num = Number(value ?? 0);
  const tone = !signed
    ? ''
    : num > 0 ? 'text-debt-600 dark:text-debt-400'
    : num < 0 ? 'text-credit-600 dark:text-credit-400'
    : 'text-concrete-500';
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap font-extrabold', !signed && 'text-gold', tone)}
      dir="ltr"
      style={{ unicodeBidi: 'isolate' }}
    >
      <span className="tnum">{fmtMoney(Math.abs(num))}</span>
      {currency && <CurrencyChip code={currency} />}
      {signed && num !== 0 && (
        <span dir="rtl" className={cn(
          'rounded px-1.5 py-0.5 text-[10px] font-semibold',
          num > 0 ? 'bg-debt-50 text-debt-700 dark:bg-debt-700/30 dark:text-debt-50' : 'bg-credit-50 text-credit-700 dark:bg-credit-700/30 dark:text-credit-50',
        )}>
          {num > 0 ? 'مدين' : 'دائن'}
        </span>
      )}
    </span>
  );
}

/* ======================= Empty / Skeleton / Error ======================= */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-2 text-ink-mid"><Inbox className="h-5 w-5" /></span>
      <p className="font-display text-sm font-semibold text-ink-hi">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-ink-mid">{hint}</p>}
      <div className="mt-4">{action ?? <a href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 py-2 text-xs font-semibold text-brand hover:bg-surface-2">العودة للوحة التحكم</a>}</div>
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('rounded-lg bg-[linear-gradient(90deg,var(--surface-2),var(--surface-3),var(--surface-2))] bg-[length:200%_100%] animate-[skeleton-shimmer_1.4s_ease-in-out_infinite]', className)} />;
}
export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-debt-600/20 bg-debt-50 px-4 py-3 text-sm text-debt-700 dark:border-debt-500/30 dark:bg-debt-700/20 dark:text-debt-50"
    >
      {message}
    </div>
  );
}

/* ============================= Pagination =============================== */
export function Pagination({ page, totalPages, onPage }: {
  page: number; totalPages: number; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="تصفح الصفحات" className="flex items-center justify-center gap-3 py-3 text-sm">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</Button>
      <span className="tnum text-concrete-700 dark:text-concrete-300">{page} / {totalPages}</span>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>التالي</Button>
    </nav>
  );
}
