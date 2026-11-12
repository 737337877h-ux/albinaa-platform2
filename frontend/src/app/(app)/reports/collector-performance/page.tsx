'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useQuery} from '@tanstack/react-query';
import {api,downloadApiFile} from '@/lib/api';
import {useCan} from '@/lib/auth';
import {fmtMoney,fmtDateTime} from '@/lib/format';
import {PageHeader} from '@/components/app-shell';
import {Button,Card,Input} from '@/components/ui/primitives';
import {DataState} from '@/components/ui/data-state';
import {toast} from '@/components/ui/toast';

export interface PerformanceReport {
 from:string;to:string;generatedAt:string;scope:'team'|'self';oracleSnapshotAt:string|null;
 sources:{platform:number;oracleMirror:number};totals:{currency:string;amount:string}[];
 rows:{collectorId:string;collectorNo:number|null;collectorName:string;currency:string;amount:string;receipts:number;customers:number;sharePercent:string|null;target:string|null;targetAttainment:string|null}[];
 activity:{collectorId:string;collectorNo:number|null;collectorName:string;active:boolean;followups:number;followedCustomers:number;assignedCustomers:number;promisesCreated:number;promisesDue:number;promisesFulfilled:number;promisesOverdue:number}[];
}
export default function CollectorPerformance(){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const can=useCan(),allowed=can('reports.read');
 const [from,setFrom]=useState(today.slice(0,7)+'-01'),[to,setTo]=useState(today),[range,setRange]=useState({from:today.slice(0,7)+'-01',to:today}),[exporting,setExporting]=useState(false);
 const q=useQuery({queryKey:['collector-performance',range],queryFn:()=>api<PerformanceReport>(`/reports/collector-performance?from=${range.from}&to=${range.to}`),enabled:allowed});
 async function excel(){setExporting(true);try{await downloadApiFile(`/reports/collector-performance.xlsx?from=${range.from}&to=${range.to}`,`collector-performance-${range.from}-${range.to}.xlsx`);}catch(e){toast((e as Error).message,'err');}finally{setExporting(false);}}
 if(!allowed)return <Card className="p-5">تحتاج صلاحية عرض التقارير.</Card>;
 return <div className="report-print space-y-5"><PageHeader title="أداء المحصلين حسب الفترة"/><Link href="/reports" className="underline">التقارير</Link>
  <Card className="space-y-3 p-4"><div className="flex flex-wrap items-end gap-3 print:hidden">
   <label>من<Input aria-label="من تاريخ" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>إلى<Input aria-label="إلى تاريخ" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <Button disabled={!from||!to||to<from||q.isFetching} onClick={()=>{setRange({from,to});if(range.from===from&&range.to===to)void q.refetch();}}>عرض التقرير</Button>
   {can('reports.export')&&<Button variant="secondary" loading={exporting} disabled={!q.data||q.isError||q.isFetching} onClick={()=>void excel()}>Excel للفترة المعروضة</Button>}
   <Button variant="secondary" onClick={()=>window.print()}>طباعة</Button>
  </div><p>الفترة شاملة يوم البداية والنهاية بتوقيت عدن، حتى 366 يومًا. تُحتسب السندات المعتمدة فقط؛ طلب القبض غير المرحّل لا يدخل في الإجمالي. كل عملة مستقلة، ونسبة المساهمة ليست عمولة مستحقة.</p></Card>
  <DataState isLoading={q.isLoading} isFetching={q.isFetching} isError={q.isError} error={q.error} onRetry={()=>void q.refetch()} isEmpty={false}>
   {q.data&&<>
    <p>الفترة المعروضة: {q.data.from} — {q.data.to} • المنصة: {q.data.sources.platform} سند • Oracle: {q.data.sources.oracleMirror} سند</p>
    <p className="text-sm text-concrete-500">آخر لقطة حركات Oracle: {q.data.oracleSnapshotAt?fmtDateTime(q.data.oracleSnapshotAt):'غير متاحة'} • تحديث التقرير: {fmtDateTime(q.data.generatedAt)}</p>
    {!q.data.oracleSnapshotAt&&<p>لا تتوفر لقطة حركات Oracle منشورة؛ المعروض من تحصيلات المنصة فقط.</p>}
    {q.data.scope==='self'&&<p>يعرض التقرير أداءك فقط؛ نسبة المساهمة على مستوى الفريق تحتاج صلاحية الرؤية الشاملة.</p>}
    <div className="flex flex-wrap gap-3">{q.data.totals.map(t=><Card className="p-4" key={t.currency}>الإجمالي {t.currency}: <b dir="ltr">{fmtMoney(t.amount)}</b></Card>)}</div>
    <Card className="overflow-x-auto p-4"><h2 className="mb-3 font-bold">التحصيل والأهداف</h2><table className="w-full text-right"><thead><tr>{['الرقم','المحصل','العملة','التحصيل','السندات','العملاء','المساهمة %','الهدف النسبي','الإنجاز %'].map(t=><th className="p-2" key={t}>{t}</th>)}</tr></thead><tbody>{q.data.rows.map(r=><tr className="border-t" key={r.collectorId+r.currency}><td>{r.collectorNo??'—'}</td><td className="p-2">{r.collectorName}</td><td>{r.currency}</td><td dir="ltr">{fmtMoney(r.amount)}</td><td>{r.receipts}</td><td>{r.customers}</td><td>{r.sharePercent??'—'}</td><td dir="ltr">{r.target==null?'غير محدد':fmtMoney(r.target)}</td><td>{r.targetAttainment??'—'}</td></tr>)}</tbody></table>{!q.data.rows.length&&<p className="p-4">لا توجد تحصيلات أو أهداف مالية بهذه الفترة.</p>}<p className="mt-3 text-sm text-concrete-500">الهدف النسبي يوزّع الهدف الشهري على أيام الفترة التقويمية. إذا غاب هدف أحد أشهر الفترة يظهر «غير محدد».</p></Card>
    <Card className="overflow-x-auto p-4"><h2 className="mb-3 font-bold">المتابعات والوعود</h2><table className="w-full text-right"><thead><tr>{['الرقم','المحصل','المتابعات','عملاء تمت متابعتهم','مسندون حاليًا','وعود أُنشئت','تستحق بالفترة','منفذة','متأخرة'].map(t=><th className="p-2" key={t}>{t}</th>)}</tr></thead><tbody>{q.data.activity.map(r=><tr className="border-t" key={r.collectorId}><td>{r.collectorNo??'—'}</td><td className="p-2">{r.collectorName}{!r.active?' (غير نشط)':''}</td>{[r.followups,r.followedCustomers,r.assignedCustomers,r.promisesCreated,r.promisesDue,r.promisesFulfilled,r.promisesOverdue].map((v,i)=><td key={i}>{v}</td>)}</tr>)}</tbody></table><p className="mt-3 text-sm text-concrete-500">المتابعات محسوبة لمن سجّلها خلال الفترة. حالات الوعود الحالية تخص مواعيد الاستحقاق داخل الفترة؛ لا تُعد صورة تاريخية لحالتها آنذاك.</p></Card>
   </>}
  </DataState>
 </div>;
}
