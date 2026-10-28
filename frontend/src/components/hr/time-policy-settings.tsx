'use client';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {Button,Input} from '@/components/ui/primitives';
import {toast} from '@/components/ui/toast';
type Rule={effectiveFrom:string;graceMinutes:number;returnGraceMinutes:number;daysDivisor:number;hoursDivisor:number;automaticAbsence:boolean;lateDeduction:boolean;monthlyLeaveDays:number};
export function TimePolicySettings({onSaved}:{onSaved:()=>void}){
 const q=useQuery({queryKey:['hr-time-policy'],queryFn:()=>api<{version:number;rules:Rule[];defaults:Rule}>('/hr/attendance/policy')});
 const [form,setForm]=useState<Rule|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const rules=[...(q.data?.rules??[])].sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
 const value=form??rules[0]??q.data?.defaults;
 if(q.isError)return <p role="alert">تعذر تحميل الإعدادات. <button onClick={()=>void q.refetch()}>إعادة المحاولة</button></p>;
 if(!value)return <p>تحميل الإعدادات…</p>;
 const change=(key:keyof Rule,v:any)=>setForm({...value,[key]:v});
 return <div className="space-y-4"><p className="text-sm text-muted-foreground">تسري التغييرات من الشهر المحدد. الكشوف المعتمدة محفوظة ولا تتغير. التعديل داخل الشهر المفتوح يعيد حساب مسوداته.</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
 <label className="space-y-2">شهر بدء التطبيق<Input type="month" min="2026-10" value={value.effectiveFrom.slice(0,7)} onChange={e=>change('effectiveFrom',e.target.value+'-01')}/></label>
 {([['graceMinutes','سماح الدخول الصباحي (دقيقة)',60],['returnGraceMinutes','سماح العودة (دقيقة)',60],['daysDivisor','مقسوم أجر اليوم',31],['hoursDivisor','ساعات أساس حساب الخصم',12]] as const).map(([key,label,max])=><label className="space-y-2" key={key}>{label}<Input type="number" min={key.includes('Grace')||key==='graceMinutes'?0:1} max={max} value={value[key]} onChange={e=>change(key,Number(e.target.value))}/></label>)}
 <label className="space-y-2">استحقاق الإجازة الشهري (يوم)<Input type="number" min="2.5" max="31" step="0.5" value={value.monthlyLeaveDays} onChange={e=>change('monthlyLeaveDays',Number(e.target.value))}/></label></div><div className="flex flex-wrap gap-6"><label><input type="checkbox" checked={value.automaticAbsence} onChange={e=>change('automaticAbsence',e.target.checked)}/> خصم الغياب تلقائيًا بعد انتهاء يوم الدوام</label><label><input type="checkbox" checked={value.lateDeduction} onChange={e=>change('lateDeduction',e.target.checked)}/> خصم التأخير بعد السماح</label></div>
 <p className="rounded-xl bg-muted p-3 text-sm">خصم الدقيقة = الأساسي ÷ {value.daysDivisor} ÷ {value.hoursDivisor} ÷ 60. الإجازات المعتمدة والعطل والإعفاءات مستثناة. الخروج المبكر والسجلات الناقصة للمراجعة.</p>
 <label className="block">سبب التعديل<Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="سبب تغيير سياسة الحضور والخصم"/></label>
 <Button disabled={busy||!q.data||reason.trim().length<3} onClick={async()=>{setBusy(true);try{await api('/hr/attendance/policy',{method:'PUT',body:JSON.stringify({...value,version:q.data!.version,reason})});await q.refetch();setForm(null);setReason('');onSaved();toast('تم حفظ السياسة وتاريخ سريانها','ok');}catch(e){toast((e as Error).message,'err');}finally{setBusy(false);}}}>{busy?'جارٍ الحفظ…':'حفظ سياسة الحضور'}</Button>
 {rules.length>0&&<div className="text-sm">تواريخ السياسات المحفوظة: {rules.map(r=>r.effectiveFrom).join('، ')}</div>}</div>;
}
