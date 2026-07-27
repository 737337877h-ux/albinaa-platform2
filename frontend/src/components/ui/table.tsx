import { cn } from '@/lib/utils';

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm', className)}>{children}</table>
    </div>
  );
}
export function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
        {cols.map((c) => <th key={c} className="px-4 py-2.5 font-medium">{c}</th>)}
      </tr>
    </thead>
  );
}
export function TRow({ children, onClick, hazard }: {
  children: React.ReactNode; onClick?: () => void; hazard?: boolean;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-concrete-100 last:border-0 dark:border-white/10',
        onClick && 'cursor-pointer hover:bg-pine-50/40 dark:hover:bg-white/5',
        hazard && 'border-r-4 border-r-hazard-500',
      )}
    >
      {children}
    </tr>
  );
}
export const TD = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <td className={cn('px-4 py-3 align-middle', className)}>{children}</td>
);
