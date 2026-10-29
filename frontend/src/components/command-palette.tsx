'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FileText, History, PackageCheck, ReceiptText, Search, Users, X } from 'lucide-react';
import { api, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';

type ResultType = 'customer' | 'receipt' | 'document' | 'reservation';
interface SearchItem { type: ResultType; id: string; title: string; subtitle: string; href: string }
interface SearchResponse { query: string; items: SearchItem[]; counts: Record<ResultType, number> }

const RECENT_KEY = 'albinaa.recent-searches';
const typeMeta: Record<ResultType, { label: string; icon: typeof Search }> = {
  customer: { label: 'عميل', icon: Users }, receipt: { label: 'إيصال', icon: ReceiptText },
  document: { label: 'مستند', icon: FileText }, reservation: { label: 'حجز', icon: PackageCheck },
};

function useDebounced(value: string, delay = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return debounced;
}

export function CommandPalette() {
  const can = useCan(); const allowed = can('customers.read'); const router = useRouter();
  const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0); const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null); const debounced = useDebounced(query.trim());
  const result = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => api<SearchResponse>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && allowed && debounced.length >= 2 && !!tokenStore.access,
    staleTime: 30_000,
  });
  const items = useMemo(() => result.data?.items ?? [], [result.data?.items]);
  const grouped = useMemo(() => (Object.keys(typeMeta) as ResultType[]).map((type) => ({
    type, items: items.filter((item) => item.type === type),
  })).filter((group) => group.items.length), [items]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); if (allowed) setOpen((value) => !value);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [allowed]);
  useEffect(() => {
    if (!open) return;
    try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]').slice(0, 5)); } catch { setRecent([]); }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  useEffect(() => { setSelected(0); }, [debounced]);

  const remember = (value: string) => {
    const clean = value.trim(); if (clean.length < 2) return;
    const next = [clean, ...recent.filter((item) => item !== clean)].slice(0, 5);
    setRecent(next); localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };
  const choose = (item: SearchItem) => {
    remember(query); setOpen(false); setQuery(''); router.push(item.href);
  };
  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(items.length - 1, value + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
    if (event.key === 'Enter' && items[selected]) { event.preventDefault(); choose(items[selected]); }
  };
  if (!allowed) return null;
  return <>
    <button onClick={() => setOpen(true)} aria-label="فتح البحث الشامل" className="flex items-center gap-2 rounded-lg border border-concrete-200 bg-white px-2.5 py-2 text-xs text-concrete-500 hover:border-pine-500 hover:text-pine-700 dark:border-white/10 dark:bg-iron-800 dark:text-concrete-300">
      <Search className="h-4 w-4" /><span className="hidden xl:inline">بحث شامل</span><kbd className="hidden rounded bg-concrete-100 px-1.5 py-0.5 font-sans text-[10px] dark:bg-white/10 sm:inline">Ctrl K</kbd>
    </button>
    {open && <div className="fixed inset-0 z-[70] flex items-start justify-center bg-iron-950/55 px-3 pt-[10vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="البحث الشامل">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl dark:bg-iron-800" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-concrete-200 px-4 dark:border-white/10">
          <Search className="h-5 w-5 text-pine-600" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onInputKey} aria-label="ابحث في المنصة" aria-controls="global-search-results" aria-activedescendant={items[selected] ? `search-${items[selected].type}-${items[selected].id}` : undefined} placeholder="عميل، كود، هاتف، إيصال، مستند، أو حجز…" className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-concrete-400" />
          {result.isFetching && <span className="h-4 w-4 animate-spin rounded-full border-2 border-pine-600 border-t-transparent" aria-label="جارٍ البحث" />}
          <button onClick={() => setOpen(false)} className="rounded p-1 text-concrete-500 hover:bg-concrete-100 dark:hover:bg-white/10" aria-label="إغلاق البحث"><X className="h-5 w-5" /></button>
        </div>
        <div id="global-search-results" role="listbox" className="max-h-[62vh] overflow-y-auto p-2">
          {debounced.length < 2 && <div className="p-3">
            <p className="mb-3 text-xs font-semibold text-concrete-500">آخر 5 عمليات بحث</p>
            {recent.length ? <div className="space-y-1">{recent.map((term) => <button key={term} onClick={() => setQuery(term)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-right text-sm hover:bg-concrete-100 dark:hover:bg-white/10"><History className="h-4 w-4 text-concrete-400" />{term}</button>)}</div> : <p className="py-8 text-center text-sm text-concrete-400">ابدأ بكتابة حرفين على الأقل</p>}
          </div>}
          {debounced.length >= 2 && result.isError && <p className="p-8 text-center text-sm text-debt-600">تعذّر البحث الآن. حاول مرة أخرى.</p>}
          {debounced.length >= 2 && !result.isFetching && !result.isError && !items.length && <p className="p-8 text-center text-sm text-concrete-500">لا توجد نتائج مطابقة</p>}
          {grouped.map((group) => <section key={group.type} aria-label={typeMeta[group.type].label}>
            <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-concrete-400">{typeMeta[group.type].label}</p>
            {group.items.map((item) => {
              const Icon = typeMeta[item.type].icon; const index = items.indexOf(item);
              return <button id={`search-${item.type}-${item.id}`} role="option" aria-selected={selected === index} key={`${item.type}-${item.id}`} onMouseEnter={() => setSelected(index)} onClick={() => choose(item)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right', selected === index ? 'bg-pine-700 text-white' : 'hover:bg-concrete-100 dark:hover:bg-white/10')}>
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', selected === index ? 'bg-white/15' : 'bg-pine-50 text-pine-700 dark:bg-pine-900/30 dark:text-pine-200')}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.title}</span><span className={cn('block truncate text-xs', selected === index ? 'text-white/70' : 'text-concrete-500')}>{item.subtitle}</span></span>
                <span className={cn('text-[10px]', selected === index ? 'text-white/60' : 'text-concrete-400')}>Enter ↵</span>
              </button>;
            })}
          </section>)}
        </div>
        <div className="flex items-center justify-between border-t border-concrete-100 px-4 py-2 text-[10px] text-concrete-400 dark:border-white/10"><span>↑↓ للتنقل • Enter للفتح • Esc للإغلاق</span><span>النتائج ضمن صلاحياتك فقط</span></div>
      </div>
    </div>}
  </>;
}
