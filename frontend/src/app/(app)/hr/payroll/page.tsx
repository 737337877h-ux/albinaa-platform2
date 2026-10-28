'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {useCan} from '@/lib/auth';
import {PageHeader} from '@/components/app-shell';
import {Button,Card,Input,Select} from '@/components/ui/primitives';
import {PayrollApprovalPanel} from '@/components/hr-payroll-approval';
type Row={employee:{id:string;employeeNo:string;fullName:string};error:string|null;saved:{updatedAt:string}|null;sourceChanged:boolean;unlinkedAdvances:number;calculation:{automaticInstallments?:string;absenceDeduction?:string;lateDeduction?:string;currency:string|null;baseSalary:string|null;fixedAllowance:string|null;incentives:string|null;deductions:string|null;installments:string|null;reviewedWithdrawals:string;net:string|null;warnings:string[];periodClosed:boolean}|null};
type Report={locked:boolean;approval:any;month:string;readAt:string;rows:Row[];summary:{employees:number;failed:number;incomplete:number;calculated:number;totals:{currency:string;baseSalary:string;net:string;calculated:number;incomplete:number}[]}};
const money=(v:string|null|undefined)=>v==null?'غير مكتمل':Number(v).toLocaleString('ar-YE',{maximumFractionDigits:2});
export default function MonthlyPayroll(){
 const can=useCan(),allowed=can('hr.read')&&can('hr.salary.read')&&can('hr.payroll.read');
 const [month,setMonth]=useState('2026-11'),[search,setSearch]=useState(''),[filter,setFilter]=useState('all');
 useEffect(()=>{const selected=new URLSearchParams(window.location.search).get('month');if(selected&&/^2026-(10|11|12)$/.test(selected))setMonth(selected);},[]);
 const q=useQuery({queryKey:['hr-monthly-payroll',month],queryFn:()=>api<Report>(`/hr/payroll?month=${month}`),enabled:allowed,retry:false,refetchOnWindowFocus:false,staleTime:0});
 if(!allowed)return <Card className="p-5">تحتاج صلاحيات عرض الموظفين والرواتب وكشف الموظف.</Card>;
 const data=q.data,rows=data?.rows.filter(r=>(r.employee.fullName+' '+r.employee.employeeNo).includes(search.trim())&&(filter==='all'||filter==='failed'&&!!r.error||filter==='incomplete'&&!r.error&&r.calculation?.net==null||filter==='calculated'&&r.calculation?.net!=null))??[];
 return <div className="space-y-5"><PageHeader title="كشف الرواتب الشهري"/>
  <Card className="space-y-3 p-4"><p>{data?.locked?'تعرض الأرقام المحفوظة وقت الاعتماد؛ تعديلها يتطلب إعادة فتح الكشف.':'كشف للمراجعة والاعتماد بعد نهاية الشهر؛ لا ينفذ صرفًا.'} بداية الاحتساب الجديدة 1 نوفمبر 2026. كشف أكتوبر محفوظ ضمن السجل السابق.</p><p>من نوفمبر تُحسب المسحوبات تلقائيًا من حركات Oracle الشهرية، وتُحسب خصومات الغياب والتأخير وفق سياسة الحضور. تُدخل الحوافز والخصومات الأخرى يدويًا.</p>
   <div className="flex flex-wrap gap-3"><label>الشهر<Select aria-label="شهر كشف الرواتب" disabled={q.isFetching} value={month} onChange={e=>setMonth(e.target.value)}>{['2026-10','2026-11','2026-12'].map(m=><option key={m}>{m}</option>)}</Select></label><Button disabled={q.isFetching} onClick={()=>void q.refetch()}>تحديث كشف الشهر</Button><Link className="underline self-center" href="/hr/employees">ملفات الموظفين والرواتب</Link></div>
  </Card>
  {q.isFetching&&<p>جارٍ قراءة كشوف الموظفين من Oracle…</p>}{q.isError&&<Card className="p-4 text-red-600">تعذرت القراءة. لا يُعتبر الكشف صفرًا؛ أعد المحاولة.</Card>}
  {!q.isError&&data&&<PayrollApprovalPanel report={data} refresh={()=>void q.refetch()} reading={q.isFetching}/>}
  {!q.isError&&data&&<><Card className="space-y-2 p-4"><p>الموظفون: {data.summary.employees} — محسوبة مبدئيًا: {data.summary.calculated} — غير مكتملة: {data.summary.incomplete} — تعذرت قراءتها: {data.summary.failed}</p><p className="text-sm">وقت اكتمال القراءة: {new Date(data.readAt).toLocaleString('ar-YE')}؛ لكل موظف لقطة قراءة مستقلة.</p>{data.summary.totals.map(t=><div key={t.currency} className="rounded border p-3"><p>العملة: {t.currency} — مجموع الرواتب الأساسية المقروءة: {money(t.baseSalary)}</p><p>{data.summary.calculated===data.summary.employees?'مجموع صافي المسودات':'مجموع صافي المسودات المحسوبة فقط — ليس إجمالي الشهر'}: {money(t.net)} — {t.calculated} موظفًا</p></div>)}<p>الراتب والبدلات من ملف الموظف. الأرصدة السابقة لنوفمبر مستبعدة من الحساب الجديد، ولا يُخصم مبلغ Oracle مرة ثانية كقسط.</p></Card>
   <div className="flex flex-wrap gap-3"><Input aria-label="بحث كشف الرواتب" placeholder="اسم الموظف أو رقمه" value={search} onChange={e=>setSearch(e.target.value)}/><Select aria-label="حالة كشف الرواتب" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">جميع الموظفين</option><option value="incomplete">بيانات ناقصة</option><option value="failed">تعذرت القراءة</option><option value="calculated">محسوبة مبدئيًا</option></Select></div>
   {rows.map(r=><Card key={r.employee.id} className="space-y-3 p-4"><h2 className="font-bold">{r.employee.employeeNo} — {r.employee.fullName}</h2>{r.error?<p className="text-red-600">{r.error}</p>:<><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['الراتب الأساسي',r.calculation?.baseSalary],['صافي مسحوبات الشهر',r.calculation?.reviewedWithdrawals],['القسط اليدوي',r.calculation?.installments],['أقساط تلقائية',r.calculation?.automaticInstallments??'0'],['خصم الغياب',r.calculation?.absenceDeduction??'0'],['خصم التأخير',r.calculation?.lateDeduction??'0'],['صافي المسودة',r.calculation?.net]].map(([label,value])=><div key={label}><p>{label}</p><strong>{money(value)} {r.calculation?.currency}</strong></div>)}</div>{!r.calculation?.periodClosed&&<p>الشهر لم ينتهِ؛ النتائج مبدئية.</p>}{r.sourceChanged&&<p>تغير المصدر منذ آخر حفظ؛ راجع المسودة.</p>}<p>{r.saved?'مسودة محفوظة':'لم تُحفظ مسودة بعد'} — طلبات سلف معتمدة غير مرتبطة بكشف: {r.unlinkedAdvances} (لا تثبت الصرف)</p><ul className="list-inside list-disc text-sm">{r.calculation?.warnings.map(w=><li key={w}>{w}</li>)}</ul></>}<Link className="inline-block underline" href={`/hr/employees/${r.employee.id}/payroll?month=${month}`}>مراجعة كشف الموظف</Link><Link className="inline-block underline mx-4" target="_blank" href={`/hr-payroll-print?month=${month}&employee=${r.employee.id}`}>قسيمة الراتب</Link></Card>)}{rows.length===0&&<p>لا توجد نتائج ضمن الاختيار.</p>}
  </>}
 </div>;
}
