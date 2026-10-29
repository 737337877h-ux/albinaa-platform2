'use client';

import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Input } from './primitives';
import { cn } from '@/lib/utils';

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
    <aside className="mr-auto h-full w-full max-w-md overflow-y-auto border-r border-line bg-surface-1 p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="mb-5 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-ink-hi">{title}</h2><button className="grid h-11 w-11 place-items-center rounded-lg hover:bg-surface-2" onClick={onClose} aria-label="إغلاق"><X className="h-5 w-5" /></button></div>{children}
    </aside>
  </div>;
}

export function ConfirmDialog({ open, onClose, title, description, confirmWord, onConfirm, loading }: {
  open: boolean; onClose: () => void; title: string; description: string; confirmWord: string;
  onConfirm: () => void; loading?: boolean;
}) {
  const [value, setValue] = useState('');
  useEffect(() => { if (!open) setValue(''); }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
    <div className="w-full max-w-md rounded-brand border border-[var(--risk-crit)] bg-surface-1 p-5 shadow-critical" onMouseDown={(event) => event.stopPropagation()}>
      <h2 className="text-lg font-bold text-[var(--risk-crit)]">{title}</h2><p className="mt-2 text-sm text-ink-mid">{description}</p>
      <label className="mt-4 block text-sm text-ink-mid">اكتب <strong className="text-ink-hi">{confirmWord}</strong> للتأكيد<Input className="mt-2" value={value} onChange={(event) => setValue(event.target.value)} autoFocus /></label>
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button variant="danger" disabled={value !== confirmWord} loading={loading} onClick={onConfirm}>تأكيد العملية</Button></div>
    </div>
  </div>;
}

export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const points = useMemo(() => {
    if (!values.length) return '';
    const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
    return values.map((value, index) => `${100 - (index / Math.max(1, values.length - 1)) * 100},${36 - ((value - min) / range) * 32}`).join(' ');
  }, [values]);
  return <svg viewBox="0 0 100 40" role="img" aria-label={label} className={cn('h-10 w-28 overflow-visible', className)}><polyline points={points} fill="none" stroke="var(--brand)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /><polyline points={`${points} 0,40 100,40`} fill="var(--brand-glow)" stroke="none" /></svg>;
}

export function AgingHeatmap({ buckets, onSelect }: { buckets: { key: string; label: string; value: number; tone: 'low' | 'mid' | 'high' | 'critical' }[]; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...buckets.map((item) => item.value));
  const colors = { low: 'var(--risk-low)', mid: 'var(--risk-mid)', high: 'var(--risk-high)', critical: 'var(--risk-crit)' };
  return <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" dir="rtl">{buckets.map((item) => <button key={item.key} onClick={() => onSelect?.(item.key)} disabled={!onSelect} className="min-h-24 rounded-brand border border-line p-3 text-right transition hover:-translate-y-0.5 hover:border-line-lit" style={{ background: `color-mix(in srgb, ${colors[item.tone]} ${12 + Math.round(item.value / max * 28)}%, var(--surface-1))` }}><span className="block text-xs text-ink-mid">{item.label}</span><span className="tnum mt-2 block text-xl font-extrabold text-ink-hi">{item.value.toLocaleString('en-US')}</span></button>)}</div>;
}
