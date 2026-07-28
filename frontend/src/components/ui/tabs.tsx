'use client';
import { cn } from '@/lib/utils';
import { createContext, useContext, useState } from 'react';

interface TabsCtx {
  active: string;
  setActive: (v: string) => void;
}
const Ctx = createContext<TabsCtx>({ active: '', setActive: () => {} });

export function Tabs({ value, onChange, children, className }: {
  value: string; onChange: (v: string) => void;
  children: React.ReactNode; className?: string;
}) {
  return (
    <Ctx.Provider value={{ active: value, setActive: onChange }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({ children, className }: {
  children: React.ReactNode; className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-concrete-100 dark:border-white/10',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, disabled, badge }: {
  value: string; children: React.ReactNode;
  disabled?: boolean; badge?: number;
}) {
  const { active, setActive } = useContext(Ctx);
  const isActive = active === value;
  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-controls={`panel-${value}`}
      disabled={disabled}
      onClick={() => setActive(value)}
      className={cn(
        'relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        isActive
          ? 'text-pine-700 dark:text-pine-100'
          : 'text-concrete-500 hover:text-iron-700 dark:text-concrete-400 dark:hover:text-concrete-100',
      )}
    >
      {children}
      {typeof badge === 'number' && badge > 0 && (
        <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-concrete-100 px-1 text-[10px] font-semibold text-concrete-600 dark:bg-white/10 dark:text-concrete-300">
          {badge}
        </span>
      )}
      {isActive && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-pine-700 dark:bg-pine-100" />
      )}
    </button>
  );
}

export function TabsPanel({ value, children }: {
  value: string; children: React.ReactNode;
}) {
  const { active } = useContext(Ctx);
  if (active !== value) return null;
  return (
    <div role="tabpanel" id={`panel-${value}`} className="pt-4">
      {children}
    </div>
  );
}
