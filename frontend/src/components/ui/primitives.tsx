'use client';
import { cn } from '@/lib/utils';
import { fmtMoney } from '@/lib/format';
import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';

/* ============================== Button ================================== */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-pine-700 text-white hover:bg-pine-800',
  secondary:
    'bg-white border border-concrete-200 text-iron-900 hover:bg-concrete-100 ' +
    'dark:bg-iron-800 dark:border-white/10 dark:text-concrete-100 dark:hover:bg-white/10',
  ghost: 'text-pine-700 hover:bg-pine-50 dark:text-pine-100 dark:hover:bg-white/10',
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
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
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
  'w-full rounded-lg border border-concrete-200 bg-white px-3 py-2 text-sm ' +
  'placeholder:text-concrete-400 focus:border-pine-500 ' +
  'dark:border-white/10 dark:bg-iron-800 dark:text-concrete-100 dark:placeholder:text-concrete-500';

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
        'rounded-xl bg-white shadow-card dark:bg-iron-800 dark:shadow-none dark:ring-1 dark:ring-white/10',
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

/* ============================ Money display ============================= */
export function Money({ value, currency, signed = false }: {
  value: number; currency?: string; signed?: boolean;
}) {
  const tone = !signed
    ? ''
    : value > 0 ? 'text-debt-600 dark:text-debt-400'
    : value < 0 ? 'text-credit-600 dark:text-credit-400'
    : 'text-concrete-500';
  return (
    <span className={cn('tnum font-medium', tone)} dir="ltr">
      {fmtMoney(Math.abs(value))}{currency ? ` ${currency}` : ''}
      {signed && value !== 0 && (value > 0 ? ' مدين' : ' دائن')}
    </span>
  );
}

/* ======================= Empty / Skeleton / Error ======================= */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="font-display text-sm font-semibold text-concrete-700 dark:text-concrete-200">{title}</p>
      {hint && <p className="mt-1 text-xs text-concrete-500">{hint}</p>}
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-concrete-100 dark:bg-white/10', className)} />;
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
