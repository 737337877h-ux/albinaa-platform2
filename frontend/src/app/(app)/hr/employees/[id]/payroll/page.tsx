'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { Button, Card, Input, Select } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';

type Review={id:string;action:'deduct'|'exclude'|'installment';reason:string;advanceRequestId?:string};
type Inputs={incentives:string|null;deductions:string|null;installments:string|null;installmentsConfirmed:boolean;reviews:Review[];notes:string;incentivesReason?:string;deductionsReason?:string;installmentsReason?:string};
type Statement={readAt:string;total:number;balances:{currency:string;opening:string;debit:string;credit:string;closing:string}[];items:{id:string;date:string;documentType:string;documentNumber:string;serial:string;description:string;currency:string;debit:string;credit:string}[]};
type Calculation={withdrawalMode?:string;baselineDate?:string;lateDeduction?:string;attendanceLines?:{date:string;kind:string;minutes?:number;amount:string}[];absenceDeduction?:string;automaticInstallments?:string;currency:string|null;baseSalary:string|null;fixedAllowance:string|null;incentives:string|null;deductions:string|null;installments:string|null;reviewedWithdrawals:string;oracleInstallments:string;net:string|null;warnings:string[];unreviewed:number};
type Advance={id:string;amount:string;currency:string;reason:string;linkedMonth:string|null};
type Workspace={locked:boolean;approval:any;employee:{id:string;employeeNo:string;fullName:string;accountLinks:{account:string;detail:string}[]};statement:Statement;inputs:Inputs;calculation:Calculation;snapshotHash:string;sourceChanged:boolean;advanceLinks:Advance[];saved:{version:number;updatedAt:string}|null};
const ccy=(s:string|null)=>s?({YER:'ريال يمني',SAR:'ريال سعودي',USD:'دولار'}[s]??s):'';
const money=(s:string|null)=>s===null?'لم يُحدد':Number(s).toLocaleString('ar-YE',{maximumFractionDigits:2});
export default function PayrollPage(){
 const {id}=useParams<{id:string}>(),can=useCan(),qc=useQueryClient();
 const allowed=can('hr.read')&&can('hr.salary.read')&&can('hr.payroll.read'),canManage=allowed&&can('hr.payroll.manage');
 const [month,setMonth]=useState('2026-11'),[input,setInput]=useState<Inputs|null>(null),[dirty,setDirty]=useState(false),[custody,setCustody]=useState('');
 useEffect(()=>{const selected=new URLSearchParams(window.location.search).get('month');if(selected&&/^2026-(10|11|12)$/.test(selected))setMonth(selected);},[]);
 const key=['hr-payroll',id,month];
 const q=useQuery({queryKey:key,queryFn:()=>api<Workspace>(`/hr/employees/${id}/payroll?month=${month}`),enabled:allowed,refetchOnWindowFocus:false,staleTime:Infinity,retry:false});
 const manage=canManage&&!q.data?.locked;
 const cq=useQuery({queryKey:['hr-custody',id,month,custody],queryFn:()=>api<Statement>(`/hr/employees/${id}/statement?month=${month}&kind=custody&detail=${encodeURIComponent(custody)}`),enabled:allowed&&!!custody,refetchOnWindowFocus:false,retry:false});
 useEffect(()=>{if(q.data){setInput(q.data.inputs);setDirty(false);}},[q.data]);
 const save=useMutation({mutationFn:()=>api(`/hr/employees/${id}/payroll?month=${month}`,{method:'PUT',body:JSON.stringify({...input,snapshotHash:q.data!.snapshotHash,version:q.data!.saved?.version??0})}),onSuccess:()=>{toast('حُفظت المسودة وأعيد حسابها؛ لم يُعتمد أو يُصرف راتب','ok');void qc.invalidateQueries({queryKey:key});},onError:(e:Error)=>toast(e.message,'err')});
 const change=(patch:Partial<Inputs>)=>{setInput(v=>v?{...v,...patch}:null);setDirty(true);};
 if(!allowed)return <Card className="p-5">تحتاج صلاحيات عرض الموظفين والرواتب وكشف الموظف.</Card>;
 const data=q.data,calc=data?.calculation,automatic=calc?.withdrawalMode==='oracle_auto',statement=custody?cq.data:data?.statement;
 function review(id:string,patch:Partial<Review>){
  if(!input)return;const old=input.reviews.find(r=>r.id===id);change({reviews:[...input.reviews.filter(r=>r.id!==id),{id,action:old?.action??'exclude',reason:old?.reason??'',advanceRequestId:old?.advanceRequestId,...patch}]});
 }
 return <div className="space-y-5">
  <PageHeader title="كشف الموظف ومسودة الراتب"/><Link href="/hr/employees" className="underline">العودة للموظفين</Link>
  {q.data?.locked&&<Card className="p-4">كشف معتمد ومقفل — النسخة {q.data.approval.revision}. هذه الأرقام محفوظة وقت الاعتماد؛ يلزم إعادة فتح الشهر مع السبب قبل تعديل المسودة.</Card>}
  <Link className="underline mx-3" target="_blank" href={`/hr-payroll-print?month=${month}&employee=${id}`}>طباعة قسيمة الراتب</Link>
  <Link href={`/hr/payroll?month=${month}`} className="underline mx-3">كشف الرواتب الشهري</Link>
  <Card className="space-y-3 p-4"><h2 className="font-bold">{data?.employee.fullName??'الموظف'} {data?.employee.employeeNo&&`(${data.employee.employeeNo})`}</h2>
   <div className="flex flex-wrap gap-3"><label>شهر المسودة<Select aria-label="شهر المسودة" disabled={dirty||save.isPending} value={month} onChange={e=>{setMonth(e.target.value);setCustody('');}}>{['2026-10','2026-11','2026-12'].map(m=><option key={m}>{m}</option>)}</Select></label><Button variant="secondary" disabled={save.isPending||q.isFetching} onClick={()=>{setInput(q.data?.inputs??null);setDirty(false);void q.refetch();if(custody)void cq.refetch();}}>{dirty?'تجاهل التعديلات وإعادة القراءة':'تحديث القراءة'}</Button></div>
   <p className="text-sm">{automatic?`بداية جديدة من ${calc?.baselineDate}. الرصيد السابق مستبعد من حساب الراتب.`:'كشف الفترة السابقة محفوظ للمراجعة.'} لا يوجد اعتماد أو صرف في هذه الشاشة.</p>
  </Card>
  {q.isFetching&&<p>جارٍ قراءة Oracle…</p>}
  {q.isError&&<Card className="p-5 text-red-600">{q.error.message} — لم تُعامل الحركات على أنها صفر.</Card>}
  {!q.isError&&data&&input&&calc&&<>
   {data.sourceChanged&&<Card className="p-4">تغيّر الكشف أو الراتب منذ آخر حفظ؛ راجع المبالغ ثم احفظ المسودة مجددًا.</Card>}
   {!automatic&&<Card className="space-y-3 p-4"><h2 className="font-bold">مطابقة طلبات السلف المعتمدة</h2><p>الموافقة لا تثبت الصرف. حركة Oracle هي مصدر الخصم الوحيد، وربط الطلب بها لا يضيف مبلغًا آخر. لا يتم الربط بالاسم أو المبلغ تلقائيًا.</p>{data.advanceLinks?.length?data.advanceLinks.map(r=><div key={r.id} className="rounded border p-3"><p>{r.reason} — {money(r.amount)} {ccy(r.currency)}</p><p>{r.linkedMonth?`مرتبط بكشف ${r.linkedMonth}`:'غير مرتبط بحركة صرف — يحتاج مراجعة'}</p></div>):<p>لا توجد طلبات سلف معتمدة لهذه الفترة أو ما قبلها.</p>}</Card>}
   {automatic&&<Card className="p-4">المسحوبات محسوبة تلقائيًا من صافي حركات حساب الراتب في Oracle خلال هذا الشهر دون تصنيف. الرصيد السابق وطلبات السلف والأقساط لا تخصم مرة ثانية. الحوافز والخصومات الأخرى يدوية والحضور تلقائي.</Card>}
   <Card className="space-y-3 p-5"><h2 className="font-bold">الحركات من Oracle</h2><label>الحساب المعروض<Select aria-label="الحساب المعروض" value={custody} onChange={e=>setCustody(e.target.value)}><option value="">سلف الرواتب — حركات الشهر</option>{data.employee.accountLinks.map(a=><option key={a.detail} value={a.detail}>العهدة {a.detail} — للعرض فقط</option>)}</Select></label>
    {custody&&<p>العهدة منفصلة؛ لا تدخل أي من مبالغها في مسودة الراتب.</p>}
    {cq.isError&&custody?<p className="text-red-600">{cq.error.message}</p>:custody&&cq.isPending?<p>جارٍ قراءة العهدة…</p>:statement&&<>
     <p className="text-sm">آخر قراءة: {new Date(statement.readAt).toLocaleString('ar-YE')} — الحركات: {statement.total}</p>
     {statement.balances.map(b=><div key={b.currency} className="rounded border p-3 text-sm">{ccy(b.currency)}: رصيد Oracle أول الشهر (للمعلومة ولا يرحّل للراتب) {money(b.opening)}؛ المدين {money(b.debit)}؛ الدائن {money(b.credit)}؛ الرصيد {money(b.closing)}</div>)}
     {statement.total===0?<p>لا توجد حركات لهذا الحساب في الشهر المحدد حتى وقت القراءة.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[800px] text-right text-sm"><thead><tr>{['التاريخ والمستند','البيان','العملة','مدين','دائن',...(!custody&&!automatic?['التصنيف','سبب التصنيف']:[])].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{statement.items.map(r=>{const rev=input.reviews.find(v=>v.id===r.id);return <tr key={r.id} className="border-t"><td className="p-2">{r.date}<br/>نوع {r.documentType} / رقم {r.documentNumber}</td><td className="p-2">{r.description}</td><td className="p-2">{ccy(r.currency)}</td><td className="p-2">{money(r.debit)}</td><td className="p-2">{money(r.credit)}</td>{!custody&&!automatic&&<><td className="p-2"><Select aria-label={`تصنيف ${r.documentNumber}`} disabled={!manage||save.isPending} value={rev?.action??''} onChange={e=>e.target.value?review(r.id,{action:e.target.value as Review['action'],advanceRequestId:undefined}):change({reviews:input.reviews.filter(v=>v.id!==r.id)})}><option value="">تحتاج مراجعة</option><option value="deduct">مسحوب أو سداد سلفة يخص راتب الشهر</option><option value="installment">قسط ضمن إجمالي قسط الشهر — يُحسب مرة واحدة</option><option value="exclude">مستبعد من راتب الشهر</option></Select></td><td className="p-2"><Input aria-label={`سبب ${r.documentNumber}`} disabled={!manage||!rev||save.isPending} value={rev?.reason??''} onChange={e=>review(r.id,{reason:e.target.value})}/>{(rev?.action==='deduct'||rev?.action==='exclude')&&Number(r.debit)>0&&Number(r.credit)===0&&<Select aria-label={`طلب السلفة ${r.documentNumber}`} disabled={!manage||save.isPending} value={rev.advanceRequestId??''} onChange={e=>review(r.id,{advanceRequestId:e.target.value||undefined})}><option value="">دون ربط بطلب من التطبيق</option>{data.advanceLinks?.filter(a=>!a.linkedMonth||a.linkedMonth===month).map(a=><option key={a.id} value={a.id}>{a.reason} — {a.amount} {a.currency}</option>)}</Select>}</td></>}</tr>})}</tbody></table></div>}
    </>}
    {!custody&&!automatic&&manage&&input.reviews.length>0&&<Button variant="secondary" onClick={()=>change({reviews:[]})}>مسح التصنيفات لإعادة المراجعة</Button>}
   </Card>
   <Card className="space-y-4 p-5"><h2 className="font-bold">مدخلات مسودة الراتب — {ccy(calc.currency)}</h2><p className="text-sm">الخصومات اليدوية لا تشمل المسحوبات المختارة أعلاه أو الأقساط أو خصومات الحضور التلقائية. أدخل صفرًا فقط عندما تتأكد من عدم وجود مبلغ.</p>
    {!automatic&&<p>قسط الشهر هو المبلغ الإجمالي المستحق، ويشمل الحركات المصنفة «قسط ضمن إجمالي قسط الشهر». هذه الحركات لا تدخل المسحوبات مرة ثانية. المبلغ المصنف من Oracle: {money(calc.oracleInstallments)} {ccy(calc.currency)}.</p>}
    <div className="grid gap-3 sm:grid-cols-3">{(['incentives','deductions','installments'] as const).filter(k=>!automatic||k!=='installments').map((k,i)=><label key={k}>{['حوافز الشهر','خصومات أخرى معتمدة','قسط الشهر من السلف القديمة'][i]}<Input aria-label={['حوافز الشهر','خصومات أخرى معتمدة','قسط الشهر'][i]} type="number" min="0" step="0.01" disabled={!manage||save.isPending} value={input[k]??''} onChange={e=>change({[k]:e.target.value===''?null:e.target.value})}/></label>)}</div>
    {!automatic&&<label className="block"><input type="checkbox" disabled={!manage||save.isPending} checked={input.installmentsConfirmed} onChange={e=>change({installmentsConfirmed:e.target.checked})}/> تم التحقق من قسط الشهر وعدم احتسابه ضمن مسحوبات Oracle مرة أخرى</label>}
    <div className="grid gap-3 sm:grid-cols-3">{(['incentivesReason','deductionsReason','installmentsReason'] as const).filter(k=>!automatic||k!=='installmentsReason').map((k,i)=><label key={k}>{['بيان ومرجع اعتماد الحوافز','بيان ومرجع اعتماد الخصومات','بيان ومرجع الأقساط'][i]}<Input aria-label={['بيان الحوافز','بيان الخصومات','بيان الأقساط'][i]} disabled={!manage||save.isPending} maxLength={500} value={input[k]??''} onChange={e=>change({[k]:e.target.value})}/></label>)}</div>
    <label className="block">ملاحظات المراجعة<Input disabled={!manage||save.isPending} value={input.notes} onChange={e=>change({notes:e.target.value})}/></label>
    {manage&&<Button loading={save.isPending} disabled={q.isFetching} onClick={()=>save.mutate()}>حفظ وإعادة حساب المسودة</Button>}
   </Card>
   <Card className="space-y-3 p-5"><h2 className="font-bold">نتيجة المسودة</h2>{dirty&&<p>توجد تعديلات لم تُحسب بعد؛ النتيجة أدناه تخص آخر قراءة أو حفظ.</p>}
    <dl className="grid grid-cols-2 gap-2">{[['الراتب الأساسي',calc.baseSalary],['البدل الثابت',calc.fixedAllowance],['الحوافز',calc.incentives],['صافي مسحوبات الشهر',calc.reviewedWithdrawals],['خصومات أخرى',calc.deductions],['الأقساط اليدوية',calc.installments],['أقساط السلف التلقائية',calc.automaticInstallments??'0'],['خصم الغياب',calc.absenceDeduction??'0'],['خصم التأخير',calc.lateDeduction??'0']].map(([name,value])=><div key={name!}><dt>{name}</dt><dd>{money(value)} {ccy(calc.currency)}</dd></div>)}</dl>
    {(calc.attendanceLines?.length??0)>0&&<details className="rounded-xl border p-3"><summary>تفاصيل خصومات الحضور والغياب</summary><div className="mt-3 space-y-2">{calc.attendanceLines?.map(line=><div key={line.date+line.kind} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"><span>{line.date} — {line.kind==='absence'?'غياب يوم كامل':`تأخير ${line.minutes} دقيقة`}</span><b>{money(line.amount)} {ccy(calc.currency)}</b></div>)}</div></details>}<p className="font-bold">صافي المسودة: {calc.net===null?'غير محسوب؛ أكمل البيانات والمراجعة':`${money(calc.net)} ${ccy(calc.currency)}`}</p>
    {calc.warnings.length>0&&<ul className="list-inside list-disc space-y-1">{calc.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
    <p className="text-sm">{data.saved?`آخر حفظ: ${new Date(data.saved.updatedAt).toLocaleString('ar-YE')}`:'لم تُحفظ مسودة لهذا الشهر بعد'}</p>
   </Card>
  </>}
 </div>;
}
