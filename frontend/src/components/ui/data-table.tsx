'use client';

import { Download, Rows3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Empty } from './primitives';

export interface DataColumn<T> {
  key: string; header: string; render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number; exportValue?: (row: T) => string | number;
}

export function DataTable<T>({ rows, columns, rowKey, emptyTitle = 'لا توجد بيانات', exportFilename }: {
  rows: T[]; columns: DataColumn<T>[]; rowKey: (row: T) => string; emptyTitle?: string; exportFilename?: string;
}) {
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && localStorage.getItem('albinaa.table-density') === 'compact');
  const visible = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key); if (!column?.sortValue) return rows;
    return [...rows].sort((a, b) => String(column.sortValue!(a)).localeCompare(String(column.sortValue!(b)), 'ar', { numeric: true }) * sort.direction);
  }, [rows, columns, sort]);
  const toggleSort = (column: DataColumn<T>) => column.sortValue && setSort((current) => current?.key === column.key ? { key: column.key, direction: current.direction === 1 ? -1 : 1 } : { key: column.key, direction: 1 });
  const toggleDensity = () => { const next = !compact; setCompact(next); localStorage.setItem('albinaa.table-density', next ? 'compact' : 'comfortable'); };
  const exportCsv = () => {
    const cells = (values: Array<string | number>) => values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
    const csv = '\uFEFF' + [cells(columns.map((column) => column.header)), ...visible.map((row) => cells(columns.map((column) => column.exportValue?.(row) ?? String(column.render(row) ?? ''))))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = exportFilename ?? 'export.csv'; link.click(); URL.revokeObjectURL(url);
  };
  if (!rows.length) return <Empty title={emptyTitle} />;
  return <div>
    <div className="flex justify-end gap-1 border-b border-line p-1 print:hidden"><button onClick={toggleDensity} className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-[11px] text-ink-mid hover:bg-surface-2"><Rows3 className="h-3.5 w-3.5" />{compact ? 'مريح' : 'مضغوط'}</button>{exportFilename && <button onClick={exportCsv} className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-[11px] text-ink-mid hover:bg-surface-2"><Download className="h-3.5 w-3.5" />تصدير</button>}</div>
    <div className="hidden overflow-x-auto sm:block"><table className={compact ? 'data-density-compact w-full text-sm' : 'w-full text-sm'}><thead className="sticky top-0 bg-surface-1"><tr>{columns.map((column) => <th key={column.key} className="px-4 py-2.5 text-right text-xs text-ink-mid"><button disabled={!column.sortValue} onClick={() => toggleSort(column)}>{column.header}{sort?.key === column.key ? (sort.direction === 1 ? ' ↑' : ' ↓') : ''}</button></th>)}</tr></thead><tbody>{visible.map((row) => <tr key={rowKey(row)} className="border-t border-line">{columns.map((column) => <td key={column.key} className="px-4 py-3">{column.render(row)}</td>)}</tr>)}</tbody></table></div>
    <div className="space-y-2 p-2 sm:hidden">{visible.map((row) => <article key={rowKey(row)} className="rounded-brand border border-line bg-surface-2 p-3">{columns.map((column) => <div key={column.key} className="flex justify-between gap-3 py-1 text-sm"><span className="text-ink-mid">{column.header}</span><span className="min-w-0 text-left text-ink-hi">{column.render(row)}</span></div>)}</article>)}</div>
  </div>;
}
