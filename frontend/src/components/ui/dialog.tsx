'use client';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function Dialog({ open, onClose, title, children, className = '' }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-iron-900/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className={`flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-iron-800 dark:ring-1 dark:ring-white/10 sm:max-h-[calc(100dvh-6rem)] sm:max-w-lg sm:rounded-2xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-concrete-100 bg-white px-5 py-4 dark:border-white/10 dark:bg-iron-800">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded p-1 hover:bg-concrete-100 dark:hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
