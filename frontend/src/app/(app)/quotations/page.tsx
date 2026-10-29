'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/app-shell';
import { Button, Card, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { CreateQuotation } from './create-quotation';

type Row = Record<string, string | number | null>;
const display = (value: Row[string]) => value == null ? '—' : String(value);

export default function QuotationsPage() {
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const capabilities = useQuery({ queryKey: ['quotation-capabilities'], queryFn: () => api<{ createEnabled: boolean; draftScope: string }>('/quotations/capabilities') });
  const query = new URLSearchParams({ search, afterSerial: cursor });
  const list = useQuery({ queryKey: ['quotations', search, cursor],
    queryFn: () => api<{items: Row[]; nextAfterSerial: string | null}>(`/quotations?${query}`) });
  const details = useQuery({ queryKey: ['quotation-lines', selected], enabled: !!selected,
    queryFn: () => api<{lines: Row[]}>(`/quotations/${selected}`) });

  return <div className="space-y-4" dir="rtl">
    <PageHeader title="عروض الأسعار" action={capabilities.data?.createEnabled ? <Button onClick={() => setShowCreate(!showCreate)}>عرض جديد</Button> : undefined} />
    {showCreate && capabilities.data?.createEnabled && <CreateQuotation scope={capabilities.data.draftScope} onSaved={() => { setCursor(''); setHistory([]); void list.refetch(); }} />}
    <p className="text-sm text-muted-foreground">عروض أسعار 2026</p>
    <Input aria-label="البحث في عروض الأسعار" placeholder="رقم العرض أو اسم العميل" value={search}
      onChange={event => { setSearch(event.target.value); setCursor(''); setHistory([]); setSelected(null); }} />
    {list.isPending && <p>جارٍ تحميل عروض الأسعار…</p>}
    {list.isError && <p role="alert">{list.error.message}</p>}
    {list.data?.items.length === 0 && <p>لا توجد عروض أسعار مطابقة.</p>}
    {list.data?.items.map(row => <Card key={String(row.SERIAL)} className="p-4 space-y-2">
      <h2 className="font-semibold">عرض رقم {display(row.DOCUMENT_NO)} — {display(row.CUSTOMER_NAME)}</h2>
      <p>التاريخ: {display(row.DOCUMENT_DATE)} · الفرع: {display(row.BRANCH_NO)}</p>
      <p>قيمة الأصناف: {display(row.AMOUNT)} {display(row.CURRENCY)} · الخصم: {display(row.DISCOUNT)} · الضريبة: {display(row.VAT)} · مصاريف أخرى: {display(row.OTHER_AMOUNT)}</p>
      <p>{Number(row.APPROVED) ? 'معتمد' : 'غير معتمد'} · {Number(row.PROCESSED) ? 'معالج' : 'غير معالج'}{Number(row.INACTIVE) ? ' · غير نشط' : ''}</p>
      <Button variant="secondary" onClick={() => setSelected(selected === row.SERIAL ? null : String(row.SERIAL))}>تفاصيل الأصناف</Button>
      {selected === row.SERIAL && <div className="overflow-x-auto">
        {details.isPending && <p>جارٍ تحميل الأصناف…</p>}
        {details.isError && <p role="alert">{details.error.message}</p>}
        {details.data && <table className="w-full text-right text-sm"><thead><tr>
          {['الصنف', 'الوصف', 'الوحدة', 'الكمية', 'السعر', 'الخصم للوحدة', 'الضريبة للوحدة', 'المستودع'].map(label => <th key={label} className="p-2">{label}</th>)}
        </tr></thead><tbody>{details.data.lines.map((line, index) => <tr key={index}>
          {['ITEM_CODE', 'DESCRIPTION', 'UNIT', 'QUANTITY', 'PRICE', 'DISCOUNT', 'VAT', 'WAREHOUSE'].map(key => <td key={key} className="p-2">{display(line[key])}</td>)}
        </tr>)}</tbody></table>}
      </div>}
    </Card>)}
    <div className="flex gap-2">
      <Button variant="secondary" disabled={!history.length || list.isFetching} onClick={() => {
        setCursor(history.at(-1) || ''); setHistory(history.slice(0, -1)); setSelected(null);
      }}>السابق</Button>
      <Button disabled={!list.data?.nextAfterSerial || list.isFetching} onClick={() => {
        setHistory([...history, cursor]); setCursor(list.data?.nextAfterSerial || ''); setSelected(null);
      }}>التالي</Button>
    </div>
  </div>;
}
