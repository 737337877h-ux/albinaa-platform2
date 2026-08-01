'use client';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Lightweight local bar-chart components — no chart library dependency.
 * Bars are plain divs sized by percent-of-max; optional href turns a row
 * into a drilldown link (e.g. to a filtered /customers list).
 */

const BAR_TONES = {
  pine: 'bg-pine-600 dark:bg-pine-400',
  debt: 'bg-debt-500 dark:bg-debt-400',
  credit: 'bg-credit-500 dark:bg-credit-400',
  hazard: 'bg-hazard-500 dark:bg-hazard-400',
  neutral: 'bg-concrete-400 dark:bg-concrete-500',
} as const;
export type BarTone = keyof typeof BAR_TONES;

export interface HBarItem {
  key: string;
  label: string;
  value: number;
  valueLabel?: string;
  href?: string;
  tone?: BarTone;
}

/** Horizontal bar list: label + proportional bar + value, optionally clickable. */
export function HBarChart({ items, emptyText }: { items: HBarItem[]; emptyText?: string }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  if (items.length === 0) {
    return <p className="px-1 py-2 text-xs text-concrete-500">{emptyText ?? 'لا بيانات'}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const pct = Math.max(2, Math.round((Math.abs(item.value) / max) * 100));
        const row = (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-concrete-600 dark:text-concrete-400">{item.label}</span>
              <span className="tnum shrink-0 font-medium text-iron-900 dark:text-concrete-100" dir="ltr">
                {item.valueLabel ?? item.value}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-concrete-100 dark:bg-white/10">
              <div
                className={cn('h-full rounded-full', BAR_TONES[item.tone ?? 'pine'])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
        return item.href ? (
          <Link
            key={item.key}
            href={item.href}
            className="block rounded-lg px-1 py-0.5 transition-colors hover:bg-pine-50/60 dark:hover:bg-white/5"
          >
            {row}
          </Link>
        ) : (
          <div key={item.key} className="px-1 py-0.5">{row}</div>
        );
      })}
    </div>
  );
}

/** Single stacked bar with a legend — used for small categorical splits (e.g. risk levels). */
export function StackedBar({ items }: { items: HBarItem[] }) {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-concrete-100 dark:bg-white/10">
        {items.map((item) => {
          const pct = total > 0 ? (Math.max(0, item.value) / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={item.key}
              className={BAR_TONES[item.tone ?? 'neutral']}
              style={{ width: `${pct}%` }}
              title={`${item.label}: ${item.valueLabel ?? item.value}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map((item) => (
          <span key={item.key} className="flex items-center gap-1.5 text-[11px] text-concrete-500">
            <span className={cn('h-2 w-2 rounded-full', BAR_TONES[item.tone ?? 'neutral'])} />
            {item.label}: <span className="tnum font-medium text-iron-900 dark:text-concrete-100">{item.valueLabel ?? item.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
