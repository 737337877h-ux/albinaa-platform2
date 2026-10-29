 'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {useCan} from '@/lib/auth';
import {PageHeader} from '@/components/app-shell';
import {Button,Card,Input} from '@/components/ui/primitives';
type Report={from:string;to:string;sources?:{platform:number;oracleMirror:number};totals:{currency:string;amount:string}[];rows:{collectorId:string;collectorName:string;currency:string;amount:string;receipts:number;customers:number;sharePercent:string|null}[]};
export default function CollectorPerformance(){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const can=useCan(),allowed=can('reports.read');
 const [from,setFrom]=useState(today.slice(0,7)+'-01'),[to,setTo]=useState(today),[range,setRange]=useState({from:today.slice(0,7)+'-01',to:today});
 const q=useQuery({queryKey:['collector-performance',range],queryFn:()=>api<Report>(`/reports/collector-performance?from=${range.from}&to=${range.to}`),enabled:allowed});
 if(!allowed)return <Card className="p-5">تحتاج صلاحية عرض التقارير.</Card>;
 return <div className="space-y-5"><PageHeader title="أداء المحصلين حسب الفترة"/><Link href="/reports" className="underline">التقارير</Link>
 <Card className="p-4 space-y-3"><div className="flex flex-wrap gap-3"><label>من<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>إلى<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><Button disabled={!from||!to||to<from||q.isFetching} onClick={()=>{setRange({from,to});if(range.from===from&&range.to===to)void q.refetch();}}>عرض التقرير</Button><Button variant="secondary" onClick={()=>window.print()}>طباعة</Button></div><p>الفترة شاملة يوم البداية والنهاية بتوقيت عدن. يشمل تحصيلات المنصة وسندات Oracle من آخر مرآة منشورة مع منع تكرار السند. التحصيلات الملغاة مستبعدة وكل عملة مستقلة. نسبة المساهمة هي حصة المحصل من إجمالي التحصيل وليست عمولة مستحقة.</p></Card>
 {q.isFetching&&<p>جارٍ قراءة التقرير…</p>}{q.isError&&<Card className="p-4 text-red-600">{q.error.message}</Card>}
 {q.data&&!q.isError&&<><p>الفترة المعروضة: {q.data.from} — {q.data.to} {q.data.sources&&`• المنصة: ${q.data.sources.platform} سند • Oracle: ${q.data.sources.oracleMirror} سند`}</p><div className="flex flex-wrap gap-3">{q.data.totals.map(t=><Card className="p-4" key={t.currency}>الإجمالي {t.currency}: <b>{Number(t.amount).toLocaleString('ar-YE',{maximumFractionDigits:2})}</b></Card>)}</div><Card className="overflow-x-auto p-4"><table className="w-full text-right"><thead><tr>{['المحصل','العملة','إجمالي التحصيل','السندات','العملاء','نسبة المساهمة'].map(t=><th className="p-2" key={t}>{t}</th>)}</tr></thead><tbody>{q.data.rows.map(r=><tr className="border-t" key={r.collectorId+r.currency}><td className="p-2">{r.collectorName}</td><td>{r.currency}</td><td>{Number(r.amount).toLocaleString('ar-YE',{maximumFractionDigits:2})}</td><td>{r.receipts}</td><td>{r.customers}</td><td>{r.sharePercent??'—'}%</td></tr>)}</tbody></table>{!q.data.rows.length&&<p className="p-5">لا توجد تحصيلات خلال هذه الفترة.</p>}</Card></>}
 </div>;
}
