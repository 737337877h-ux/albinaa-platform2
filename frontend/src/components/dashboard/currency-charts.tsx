'use client';
import {useState} from 'react';
import {HBarChart} from '@/components/ui/charts';
import {Card,CardHeader,Select} from '@/components/ui/primitives';
import {CCY_AR,fmtMoney} from '@/lib/format';
import type {KpiResponse} from './types';

export function CurrencyCharts({data}:{data:KpiResponse}) {
  const currencies=Array.from(new Set([...Object.keys(data.debtByCurrency),...data.collectorPerformanceToday.map(c=>c.currency)])).sort();
  const [selected,setSelected]=useState('');
  const currency=currencies.includes(selected)?selected:currencies[0]??'';
  const collectors=data.collectorPerformanceToday.filter(c=>c.currency===currency);
  return <section aria-label="المؤشرات حسب العملة" className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">عملة الرسوم<Select aria-label="عملة الرسوم" value={currency} onChange={e=>setSelected(e.target.value)} disabled={!currencies.length}>{currencies.map(c=><option key={c} value={c}>{CCY_AR[c]??c} — {c}</option>)}</Select></label>
      <p className="text-sm text-ink-mid">كل رسم يعرض عملة واحدة؛ لا تحويل بين العملات. السالب يسار خط الصفر والموجب يمينه.</p>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><CardHeader title={`المديونية — ${currency||'لا عملة'}`}/><div className="p-4"><HBarChart emptyText="لا مديونية مسجلة لهذه العملة" items={currency&&data.debtByCurrency[currency]!=null?[{key:currency,label:CCY_AR[currency]??currency,value:data.debtByCurrency[currency],valueLabel:`${fmtMoney(data.debtByCurrency[currency])} ${currency}`,href:`/customers?balanceState=debtor&currency=${encodeURIComponent(currency)}`,tone:'debt'}]:[]}/></div></Card>
      <Card><CardHeader title={`أداء المحصلين اليوم — ${currency||'لا عملة'}`}/><div className="p-4"><HBarChart emptyText="لا تحصيلات مسجلة لهذه العملة اليوم" items={collectors.map(c=>({key:c.collectorId,label:c.collectorName,value:c.amount,valueLabel:`${fmtMoney(c.amount)} ${currency}`,tone:'pine'}))}/></div></Card>
    </div>
  </section>;
}
