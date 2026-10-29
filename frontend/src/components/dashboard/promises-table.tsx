import Link from 'next/link';
import type {PromiseItem} from './types';
import {Table,THead,TRow,TD} from '@/components/ui/table';
import {Badge,Money} from '@/components/ui/primitives';
import {PROMISE_STATUS_AR} from '@/lib/format';
export function PromisesTable({ items, tone }: { items: PromiseItem[]; tone: 'hazard' | 'debt' }) {
  return (
    <Table>
      <THead cols={['العميل', 'المبلغ', 'الحالة']} />
      <tbody>
        {items.map((p) => {
          const customerId = p.customer?.id;
          const customerName = p.customer?.name ?? '—';
          return (
            <TRow key={p.id}>
              <TD>
                {customerId ? (
                  <Link className="text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${customerId}`}>
                    {customerName}
                  </Link>
                ) : (
                  <span>{customerName}</span>
                )}
              </TD>
              <TD><Money value={Number(p.expectedAmount)} currency={p.currencyCode} /></TD>
              <TD><Badge tone={tone}>{PROMISE_STATUS_AR[p.status] ?? p.status}</Badge></TD>
            </TRow>
          );
        })}
      </tbody>
    </Table>
  );
}
