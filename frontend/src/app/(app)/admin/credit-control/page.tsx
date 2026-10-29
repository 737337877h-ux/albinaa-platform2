'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button, Card, Field, Input, Money, Pagination, Select } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtMoney } from '@/lib/format';

interface Row {
  id: string; name: string; externalCustomerCode: string; accountNumber: string | null;
  balances: { currency: string; amount: number }[];
  creditLimits: { currencyCode: string; amount: number; used: number; utilization: number | null }[];
  creditPolicy: { creditStatus: string; allowCreditSale: boolean } | null;
}
interface Response { page: number; limit: number; total: number; totalPages: number; missingLimits: number; items: Row[] }

export default function CreditControlPage() {
  const can = useCan();
  const allowed = can('customers.read');
  const canWrite = can('customers.write');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [customer, setCustomer] = useState<Row | null>(null);
  const [currency, setCurrency] = useState('YER');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const query = useQuery<Response>({
    queryKey: ['credit-control', page, search, missingOnly],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25', search, missingOnly: String(missingOnly) });
      return api(`/customers/credit-control?${params.toString()}`);
    }, enabled: allowed,
  });
  const save = useMutation({
    mutationFn: () => api(`/customers/${customer!.id}/credit-limits/${currency}`, {
      method: 'PATCH', body: JSON.stringify({ amount: Number(amount), effectiveFrom: new Date().toISOString(), reason: reason || undefined }),
    }),
    onSuccess: async () => {
      toast('تم اعتماد سقف الائتمان وتحديث المخاطر', 'ok'); setCustomer(null); setAmount(''); setReason('');
      await queryClient.invalidateQueries({ queryKey: ['credit-control'] });
    }, onError: (error: Error) => toast(error.message, 'err'),
  });
  const open = (row: Row, code = 'YER') => {
    const existing = row.creditLimits.find((item) => item.currencyCode === code);
    setCustomer(row); setCurrency(code); setAmount(existing ? String(existing.amount) : ''); setReason('');
  };
  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية عرض الرقابة الائتمانية" /></Card>;
  return <div className="space-y-5">
    <PageHeader title="الرقابة وسياسات الائتمان" />
    <div className="grid gap-3 sm:grid-cols-3">
      <Card className="p-4"><p className="text-xs text-concrete-500">إجمالي الحسابات</p><p className="tnum text-3xl font-bold">{query.data?.total ?? '—'}</p></Card>
      <Card className="border-r-4 border-r-hazard-500 p-4"><p className="text-xs text-concrete-500">بلا سقف ائتمان</p><p className="tnum text-3xl font-bold text-hazard-700">{query.data?.missingLimits ?? '—'}</p></Card>
      <Card className="p-4"><p className="text-xs text-concrete-500">المبدأ</p><p className="mt-1 text-sm">لا تُعتمد قيمة افتراضية تلقائيًا؛ كل سقف قرار مالي موثق حسب العملة.</p></Card>
    </div>
    <Card className="p-3"><div className="flex flex-wrap gap-2"><div className="relative min-w-64 flex-1"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-concrete-400" /><Input className="pr-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="بحث بالاسم أو رقم الحساب" /></div><Button variant={missingOnly ? 'primary' : 'secondary'} onClick={() => { setMissingOnly((value) => !value); setPage(1); }}>بلا سقف فقط</Button></div></Card>
    <Card className="overflow-hidden"><DataState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} isFetching={query.isFetching} isEmpty={!query.data?.items.length} emptyTitle="لا توجد حسابات مطابقة" skeletonClassName="h-64">
      <Table><THead cols={['العميل', 'الأرصدة', 'حدود الائتمان', 'الاستخدام', 'السياسة', 'الإجراء']} /><tbody>{(query.data?.items ?? []).map((row) => <TRow key={row.id}>
        <TD><Link href={`/customers/${row.id}`} className="font-semibold text-pine-700 hover:underline dark:text-pine-100">{row.name}</Link><p dir="ltr" className="text-xs text-concrete-500">{row.externalCustomerCode}</p></TD>
        <TD><div className="space-y-1">{row.balances.map((balance) => <Money key={balance.currency} value={balance.amount} currency={balance.currency} />)}</div></TD>
        <TD>{row.creditLimits.length ? <div className="space-y-1">{row.creditLimits.map((limit) => <p key={limit.currencyCode} className="tnum text-xs" dir="ltr">{fmtMoney(limit.amount)} {limit.currencyCode}</p>)}</div> : <Badge tone="hazard">غير محدد</Badge>}</TD>
        <TD>{row.creditLimits.map((limit) => <p key={limit.currencyCode} className={`tnum text-xs ${(limit.utilization ?? 0) > 100 ? 'text-debt-600' : ''}`}>{limit.currencyCode}: {limit.utilization == null ? '—' : `${limit.utilization.toFixed(1)}%`}</p>)}</TD>
        <TD><Badge tone={row.creditPolicy?.creditStatus === 'blocked' ? 'debt' : row.creditPolicy?.creditStatus === 'restricted' ? 'hazard' : 'pine'}>{row.creditPolicy?.creditStatus ?? 'غير مضبوطة'}</Badge></TD>
        <TD>{canWrite && <Button variant="secondary" onClick={() => open(row)}><ShieldCheck className="h-4 w-4" />ضبط السقف</Button>}</TD>
      </TRow>)}</tbody></Table><Pagination page={query.data?.page ?? page} totalPages={query.data?.totalPages ?? 1} onPage={setPage} />
    </DataState></Card>
    <Dialog open={!!customer} onClose={() => setCustomer(null)} title={`اعتماد سقف ائتمان — ${customer?.name ?? ''}`}>
      <div className="space-y-4"><Field label="العملة"><Select value={currency} onChange={(e) => { const code = e.target.value; setCurrency(code); setAmount(String(customer?.creditLimits.find((item) => item.currencyCode === code)?.amount ?? '')); }}><option>YER</option><option>SAR</option><option>USD</option></Select></Field><Field label="السقف المعتمد"><Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="سبب القرار"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="قرار الإدارة أو مرجع الاعتماد" /></Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCustomer(null)}>إلغاء</Button><Button disabled={amount === '' || Number(amount) < 0} loading={save.isPending} onClick={() => save.mutate()}>اعتماد</Button></div></div>
    </Dialog>
  </div>;
}
