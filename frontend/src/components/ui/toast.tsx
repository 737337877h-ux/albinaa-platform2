'use client';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

/** إشعارات فورية بلا تبعيات خارجية. */
type Toast = { id: number; message: string; tone: 'ok' | 'err' };
type Listener = () => void;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let nextId = 1;
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, tone: 'ok' | 'err' = 'ok') {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => toasts,
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto rounded-lg px-4 py-3 text-sm text-white shadow-lg',
            t.tone === 'ok' ? 'bg-pine-700' : 'bg-debt-600',
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
