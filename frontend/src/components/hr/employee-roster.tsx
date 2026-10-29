'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {useCan} from '@/lib/auth';
import {Card,Input,Select,Button,Badge} from '@/components/ui/primitives';
import {DataTable} from '@/components/ui/data-table';
import {toast} from '@/components/ui/toast';
export async function downloadHr(path:string){const d=await api<{name:string;mime:string;base64:string}>(path);const bytes=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:d.mime}));const a=document.createElement('a');a.href=url;a.download=d.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function EmployeeRoster({employees,onEdit,onSalary}:{employees:any[];onEdit:(e:any)=>void;onSalary:(e:any)=>void}){
 const can=useCan(),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[department,setDepartment]=useState(''),[branch,setBranch]=useState(''),[job,setJob]=useState(''),[contract,setContract]=useState('');
 const [month,setMonth]=useState(()=>{const m=new Date(Date.now()+10800000).toISOString().slice(0,7);return m<'2026-10'?'2026-10':m;});
 const q=useQuery({queryKey:['hr-personnel',employees.map(e=>`${e.id}:${e.version}`).join(',')],queryFn:()=>api<any>('/hr/personnel')});
 if(q.isPending)return <p>جارٍ تحميل سجل الكادر…</p>;
 if(q.isError)return <Card className="p-4">تعذر تحميل سجل الكادر: {q.error.message}<Button onClick={()=>q.refetch()}>إعادة المحاولة</Button></Card>;
 const rows:any[]=q.data.employees,branches:any[]=q.data.branches;
 const salary=(e:any)=>e.salaries?.find((s:any)=>s.effectiveFrom.slice(0,10)<=month+'-01');
 const totals:Record<string,number>={};let incomplete=0;rows.filter(e=>e.active).forEach(e=>{const s=salary(e);if(!s||s.fixedAllowance==null){incomplete++;return;}totals[s.currency]=(totals[s.currency]??0)+Number(s.baseSalary)+Number(s.fixedAllowance);});
 const soon=new Date(q.data.date+'T00:00:00Z');soon.setUTCDate(soon.getUTCDate()+30);
 const visible=rows.filter(e=>(status===''||String(e.active)===status)&&(!department||e.profile.department===department)&&(!branch||e.profile.branchId===branch)&&(!job||e.jobTitle===job)&&(!contract||e.profile.contractType===contract)&&`${e.fullName} ${e.employeeNo} ${e.profile.phone??''} ${e.profile.nationalId??''}`.toLowerCase().includes(search.toLowerCase()));
 const options=(key:string)=>[...new Set(rows.map(e=>key==='jobTitle'?e.jobTitle:e.profile[key]).filter(Boolean))] as string[];
 return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
 <Card className="p-4">الموظفون النشطون<strong className="block text-2xl">{rows.filter(e=>e.active).length}</strong><small>إجمالي الكادر {rows.length} — غير النشط {rows.filter(e=>!e.active).length}</small></Card>
 {can('hr.salary.read')&&<Card className="p-4">الأجور الثابتة لشهر {month}{Object.entries(totals).map(([c,v])=><strong className="block" key={c}>{v.toLocaleString('ar-YE')} {c}</strong>)}{incomplete>0&&<small>{incomplete} ملف دون راتب/بدل مكتمل للفترة</small>}</Card>}
 <Card className="p-4">في إجازة اليوم<strong className="block text-2xl">{rows.filter(e=>e.active&&e.onLeave).length}</strong><small>{q.data.date}</small></Card>
 <Card className="p-4">عقود تنتهي خلال 30 يومًا<strong className="block text-2xl">{rows.filter(e=>e.active&&e.profile.contractEnd>=q.data.date&&e.profile.contractEnd<=soon.toISOString().slice(0,10)).length}</strong><small>{rows.filter(e=>!e.profile.contractEnd).length} دون تاريخ نهاية مسجل</small></Card></div>
 <Card className="grid gap-3 p-4 sm:grid-cols-3"><Input aria-label="بحث الكادر" placeholder="الاسم، الكود، الهاتف، الهوية" value={search} onChange={e=>setSearch(e.target.value)}/><Select aria-label="حالة الموظف" value={status} onChange={e=>setStatus(e.target.value)}><option value="">كل الحالات</option><option value="true">نشط</option><option value="false">غير نشط</option></Select><Select aria-label="الفرع" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select>
 {([[department,setDepartment,'department','القسم'],[job,setJob,'jobTitle','الوظيفة'],[contract,setContract,'contractType','نوع العقد']] as const).map(([value,set,key,label])=><Select key={key} aria-label={label} value={value} onChange={e=>set(e.target.value)}><option value="">كل {label}</option>{options(key).map(v=><option key={v} value={v}>{({permanent:'دائم',fixed:'محدد',temporary:'مؤقت',probation:'تجربة',unspecified:'غير محدد'} as Record<string,string>)[v]??v}</option>)}</Select>)}
 <label>شهر الأجور<Input type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label><Button onClick={()=>downloadHr('/hr/personnel/export').catch(e=>toast(e.message,'err'))}>تصدير كشف الموظفين Excel</Button></Card>
 <Card><DataTable rows={visible} rowKey={e=>e.id} columns={[
 {key:'employee',header:'الموظف',sortValue:e=>e.fullName,render:e=><Link className="underline" href={`/hr/employees/${e.id}`}><span className="inline-flex rounded-full bg-surface-2 p-2 ml-2" aria-hidden>{e.fullName.slice(0,1)}</span>{e.fullName}<small className="block">{e.employeeNo}</small></Link>},
 {key:'job',header:'الوظيفة والفرع',render:e=><>{e.jobTitle||'غير محدد'}<small className="block">{e.profile.department||'قسم غير محدد'} / {branches.find(b=>b.id===e.profile.branchId)?.name??'فرع غير محدد'}<br/>المباشرة: {e.profile.joinDate??'غير مسجلة'}</small></>},
 ...(can('hr.salary.read')?[{key:'salary',header:'الأجر الثابت',render:(e:any)=>{const s=salary(e);return s?<>{Number(s.baseSalary).toLocaleString('ar-YE')} {s.currency}<small className="block">البدلات: {s.fixedAllowance??'غير محددة'}</small></>:'غير مسجل للفترة';}}]:[]),
 {key:'balances',header:'الإجازة والسلف',render:e=><>الإجازة: {e.leaveBalance?`${e.leaveBalance.remaining} يوم`:'الرصيد غير مسجل'}{can('hr.salary.read')&&<small className="block">{e.advanceRequests.length} طلب سلفة معتمد — الصرف والرصيد يراجعان في المسير</small>}</>},
 {key:'status',header:'الحالة',render:e=><><Badge>{e.active?'نشط':'غير نشط'}</Badge><small className="block">{({exempt:'معفى',leave:'إجازة معتمدة',present:'حضور مسجل',no_record:'دون تسجيل اليوم'} as Record<string,string>)[e.attendanceStatus]}</small></>},
 {key:'actions',header:'الإجراءات',render:e=><div className="flex flex-wrap gap-2"><Link className="underline" href={`/hr/employees/${e.id}`}>الملف الشامل</Link>{can('hr.manage')&&<Button variant="secondary" onClick={()=>onEdit(e)}>تعديل</Button>}{can('hr.salary.manage')&&can('hr.salary.read')&&<Button variant="secondary" onClick={()=>onSalary(e)}>الأجور</Button>}{can('hr.payroll.read')&&can('hr.salary.read')&&<Link className="underline" href={`/hr/employees/${e.id}/payroll`}>المسير</Link>}</div>}
 ]}/></Card></div>;
}
