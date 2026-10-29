'use client';
import {EmployeeRoster} from '@/components/hr/employee-roster';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { Button, Card, Input, Select } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';

type Salary={id:string;baseSalary:string;fixedAllowance:string|null;currency:string;effectiveFrom:string};
type Employee={id:string;employeeNo:string;fullName:string;jobTitle:string;managerNo:string|null;active:boolean;workMode:string;attendanceExempt:boolean;startTime:string|null;endTime:string|null;breakMinutes:number;breakStartTime:string|null;breakEndTime:string|null;workDays:number[];notes:string;version:number;legacyInstallmentsPending:boolean;accountLinks:{account:string;detail:string}[];salaries?:Salary[]};
type Form=Omit<Employee,'id'|'salaries'|'accountLinks'|'legacyInstallmentsPending'>;
const days=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const modes:Record<string,string>={office:'داخل المنشأة',field:'ميداني',mixed:'مختلط'};
const money=(v:string)=>Number(v).toLocaleString('ar-YE');
const initial:Form={employeeNo:'',fullName:'',jobTitle:'',managerNo:null,active:true,workMode:'office',attendanceExempt:false,startTime:null,endTime:null,breakMinutes:90,breakStartTime:'13:00',breakEndTime:'14:30',workDays:[6,0,1,2,3,4],notes:'',version:0};
export default function EmployeesPage(){
 const can=useCan(),qc=useQueryClient();
 const [form,setForm]=useState<Form|null>(null),[editId,setEditId]=useState<string|null>(null),[salaryFor,setSalaryFor]=useState<Employee|null>(null);
 const [salary,setSalary]=useState({baseSalary:'',fixedAllowance:'',currency:'YER',effectiveFrom:'2026-10-01'});
 const q=useQuery({queryKey:['hr-employees'],queryFn:()=>api<Employee[]>('/hr/employees'),enabled:can('hr.read')});
 const refresh=()=>qc.invalidateQueries({queryKey:['hr-employees']});
 const save=useMutation({mutationFn:()=>api(editId?`/hr/employees/${editId}`:'/hr/employees',{method:editId?'PUT':'POST',body:JSON.stringify(form)}),onSuccess:()=>{setForm(null);void refresh();toast('تم حفظ بيانات الموظف','ok');},onError:(e:Error)=>toast(e.message,'err')});
 const saveSalary=useMutation({mutationFn:()=>api(`/hr/employees/${salaryFor!.id}/salaries`,{method:'POST',body:JSON.stringify({...salary,fixedAllowance:salary.fixedAllowance===''?null:salary.fixedAllowance,version:salaryFor!.version})}),onSuccess:()=>{setSalaryFor(null);void refresh();toast('تم حفظ الراتب وتاريخ سريانه','ok');},onError:(e:Error)=>toast(e.message,'err')});
 if(!can('hr.read'))return <Card className="p-6">لا تملك صلاحية عرض الموظفين.</Card>;
 const employees=q.data??[];
 function edit(e?:Employee){setEditId(e?.id??null);setForm(e?{employeeNo:e.employeeNo,fullName:e.fullName,jobTitle:e.jobTitle,managerNo:e.managerNo,active:e.active,workMode:e.workMode,attendanceExempt:e.attendanceExempt,startTime:e.startTime,endTime:e.endTime,breakMinutes:e.breakMinutes,breakStartTime:e.breakStartTime,breakEndTime:e.breakEndTime,workDays:e.workDays,notes:e.notes,version:e.version}:{...initial});}
 function field(key:keyof Form,value:unknown){setForm(f=>f?{...f,[key]:value}:null);}
 return <div className="space-y-5">
  <PageHeader title="الموظفون والرواتب" />
  {can('hr.payroll.read')&&can('hr.salary.read')&&<Link className="inline-block underline mx-3" href="/hr/payroll">كشف الرواتب الشهري</Link>}
  <Link className="inline-block underline" href="/hr/requests">طلبات السلف والإجازات وربط حسابات الموظفين</Link>
  <Link className="inline-block underline mx-3" href="/hr/attendance">الحضور والانصراف ورمز المنشأة</Link>
  <Link className="inline-block underline mx-3" href="/hr/tasks">مهام الموظفين اليومية</Link>
  <Card className="space-y-3 p-4"><p>الموظفون: {employees.length} — النشطون: {employees.filter(e=>e.active).length} — المعفون من الحضور: {employees.filter(e=>e.attendanceExempt).length}</p><p className="text-sm">القسط الشهري بحد أقصى 10% من الأساسي. الغياب غير المبرر المؤكد يُخصم على أساس الأساسي ÷ 30؛ الإجازة والعطلة والإعفاء مستثناة.</p><div className="flex gap-3">{can('hr.manage')&&<Button onClick={()=>edit()}>إضافة موظف</Button>}</div></Card>
  {q.isPending&&<p>جارٍ تحميل الموظفين…</p>}{q.isError&&<Card className="p-4"><p>تعذر تحميل الموظفين: {q.error.message}</p><Button onClick={()=>q.refetch()}>إعادة المحاولة</Button></Card>}
  {!q.isPending&&!q.isError&&<EmployeeRoster employees={employees} onEdit={edit} onSalary={e=>{const s=e.salaries?.[0];setSalaryFor(e);setSalary({baseSalary:s?.baseSalary??'',fixedAllowance:s?.fixedAllowance??'',currency:s?.currency??'YER',effectiveFrom:s?.effectiveFrom.slice(0,10)??'2026-10-01'});}}/>}
  {!q.isPending&&!q.isError&&employees.length===0&&<p>لا توجد ملفات موظفين بعد.</p>}
  <Dialog open={!!form} onClose={()=>!save.isPending&&setForm(null)} title={editId?'تعديل الموظف':'إضافة موظف'}>{form&&<form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
   <div className="grid gap-3 sm:grid-cols-2">{(['employeeNo','fullName','jobTitle'] as const).map((k,i)=><label key={k}>{['رقم الموظف في Oracle','اسم الموظف','الوظيفة'][i]}<Input required={k!=='jobTitle'} disabled={k==='employeeNo'&&!!editId} value={form[k]} onChange={e=>field(k,e.target.value)}/></label>)}
    <label>المسؤول المباشر<Select value={form.managerNo??''} onChange={e=>field('managerNo',e.target.value||null)}><option value="">غير محدد</option>{employees.filter(e=>e.employeeNo!==form.employeeNo&&e.active).map(e=><option key={e.id} value={e.employeeNo}>{e.fullName}</option>)}</Select></label>
    <label>طبيعة العمل<Select value={form.workMode} onChange={e=>field('workMode',e.target.value)}>{Object.entries(modes).map(([v,n])=><option key={v} value={v}>{n}</option>)}</Select></label>
   </div><label className="block"><input type="checkbox" checked={form.active} onChange={e=>field('active',e.target.checked)}/> موظف نشط</label><label className="block"><input type="checkbox" checked={form.attendanceExempt} onChange={e=>field('attendanceExempt',e.target.checked)}/> معفى من تسجيل الحضور والانصراف</label>
   {!form.attendanceExempt&&<div className="grid grid-cols-3 gap-2"><label>البداية<Input type="time" required value={form.startTime??''} onChange={e=>field('startTime',e.target.value)}/></label><label>النهاية<Input type="time" required value={form.endTime??''} onChange={e=>field('endTime',e.target.value)}/></label><label>الراحة بالدقائق<Input type="number" min={0} max={1440} required value={form.breakMinutes} onChange={e=>field('breakMinutes',Number(e.target.value))}/></label></div>}
   <div className="grid grid-cols-2 gap-3"><label>بداية الاستراحة<Input type="time" value={form.breakStartTime??''} onChange={e=>field('breakStartTime',e.target.value)}/></label><label>نهاية الاستراحة<Input type="time" value={form.breakEndTime??''} onChange={e=>field('breakEndTime',e.target.value)}/></label></div><fieldset><legend>أيام العمل</legend><div className="flex flex-wrap gap-3">{days.map((d,n)=><label key={n}><input type="checkbox" checked={form.workDays.includes(n)} onChange={e=>field('workDays',e.target.checked?[...form.workDays,n]:form.workDays.filter(v=>v!==n))}/> {d}</label>)}</div></fieldset>
   <label className="block">ملاحظات<Input value={form.notes} onChange={e=>field('notes',e.target.value)}/></label><Button type="submit" loading={save.isPending}>حفظ الموظف</Button>
  </form>}</Dialog>
  <Dialog open={!!salaryFor} onClose={()=>!saveSalary.isPending&&setSalaryFor(null)} title={`راتب ${salaryFor?.fullName??''}`}><form className="space-y-4" onSubmit={e=>{e.preventDefault();saveSalary.mutate();}}><p className="text-sm">اختيار تاريخ جديد يحفظ فترة راتب جديدة. اختيار تاريخ موجود يصحح تلك الفترة مع تسجيل التغيير.</p>
   <label className="block">الراتب الشهري الأساسي<Input type="number" min="0" step="0.01" required value={salary.baseSalary} onChange={e=>setSalary({...salary,baseSalary:e.target.value})}/></label><label className="block">البدل الشهري الثابت (فارغ = لم يُحدد)<Input type="number" min="0" step="0.01" value={salary.fixedAllowance} onChange={e=>setSalary({...salary,fixedAllowance:e.target.value})}/></label>
   <label className="block">العملة<Select value={salary.currency} onChange={e=>setSalary({...salary,currency:e.target.value})}>{['YER','SAR','USD'].map(c=><option key={c}>{c}</option>)}</Select></label><label className="block">يسري من<Input type="date" min="2026-10-01" required value={salary.effectiveFrom} onChange={e=>setSalary({...salary,effectiveFrom:e.target.value})}/></label><Button type="submit" loading={saveSalary.isPending}>حفظ الراتب</Button>
  </form></Dialog>
 </div>;
}
