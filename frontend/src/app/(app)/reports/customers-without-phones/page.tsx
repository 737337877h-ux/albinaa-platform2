'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useQuery} from '@tanstack/react-query';
import {api,downloadApiFile} from '@/lib/api';
import {useCan} from '@/lib/auth';
import {PageHeader} from '@/components/app-shell';
import {Button,Card,Input,Select,Pagination} from '@/components/ui/primitives';
import {DataState} from '@/components/ui/data-state';
import {toast} from '@/components/ui/toast';
interface PhoneReport {total:number;totalPages:number;collectors:{id:string;name:string}[];items:{id:string;externalCustomerCode:string;accountNumber:string|null;name:string;collectorName:string|null;branch:string|null;region:string|null;reason:string}[];}
export default function CustomersWithoutPhones(){
 const can=useCan(),allowed=can('customers.read');
 const [search,setSearch]=useState(''),[applied,setApplied]=useState(''),[collector,setCollector]=useState(''),[accountClass,setClass]=useState('customer'),[status,setStatus]=useState('active'),[page,setPage]=useState(1),[busy,setBusy]=useState(false);
 const params=new URLSearchParams({search:applied,accountClass,status,page:String(page),limit:'25'});if(collector)params.set('collectorId',collector);
 const query=useQuery({queryKey:['missing-phones',params.toString()],queryFn:()=>api<PhoneReport>(`/customers/without-phones?${params}`),enabled:allowed});
 const [collectorOptions,setCollectorOptions]=useState<PhoneReport['collectors']>([]);
 useEffect(()=>{if(query.data)setCollectorOptions(query.data.collectors);},[query.data]);
 async function excel(){setBusy(true);try{await downloadApiFile(`/customers/without-phones.xlsx?${params}`,'customers-without-phones.xlsx');}catch(e){toast((e as Error).message,'err');}finally{setBusy(false);}}
 if(!allowed)return <Card>لا تملك صلاحية عرض العملاء.</Card>;
 return <div className="space-y-5"><PageHeader title="العملاء دون أرقام هاتف"/><Link href="/customers" className="underline">قائمة العملاء</Link>
  <Card className="space-y-4 p-4"><p>يشمل الحساب إذا لم يوجد رقم قابل للاستخدام في الهاتف الرئيسي أو الإضافي أو واتساب. تُستبعد الحسابات المدمجة، ويُطبّق نطاق إسنادك نفسه.</p>
   <div className="flex flex-wrap gap-3"><Input className="max-w-sm" aria-label="بحث العملاء" placeholder="اسم العميل أو الكود أو رقم الحساب" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){setApplied(search.trim());setPage(1);}}}/><Button onClick={()=>{setApplied(search.trim());setPage(1);}}>بحث</Button>
    <Select aria-label="نوع الحساب" value={accountClass} onChange={e=>{setClass(e.target.value);setCollector('');setPage(1);}}><option value="customer">العملاء</option><option value="advance">السلف</option></Select>
    <Select aria-label="المحصل" value={collector} onChange={e=>{setCollector(e.target.value);setPage(1);}}><option value="">كل الإسنادات المتاحة</option><option value="unassigned">غير مسند</option>{collectorOptions.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select>
    <Select aria-label="الحالة" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="all">كل الحالات</option></Select>
    {can('reports.export')&&<Button variant="secondary" loading={busy} disabled={query.isFetching||query.isError||!query.data?.total} onClick={()=>void excel()}>Excel لكل النتائج المطابقة</Button>}
   </div></Card>
  <DataState isLoading={query.isLoading} isFetching={query.isFetching} isError={query.isError} error={query.error} onRetry={()=>void query.refetch()} isEmpty={query.data?.total===0} emptyTitle="لا توجد حسابات دون أرقام بهذه الفلاتر">
   {query.data&&<><p>النتائج: {query.data.total}</p><Card className="overflow-x-auto p-4"><table className="w-full text-right"><thead><tr>{['كود العميل','رقم الحساب','العميل','المحصل الحالي','الفرع','المنطقة','سبب الظهور'].map(t=><th className="p-2" key={t}>{t}</th>)}</tr></thead><tbody>{query.data.items.map(c=><tr key={c.id} className="border-t"><td>{c.externalCustomerCode}</td><td>{c.accountNumber??'—'}</td><td className="p-2"><Link className="underline" href={`/customers/${c.id}`}>{c.name}</Link></td><td>{c.collectorName??'غير مسند'}</td><td>{c.branch??'—'}</td><td>{c.region??'—'}</td><td>{c.reason}</td></tr>)}</tbody></table></Card><Pagination page={page} totalPages={query.data.totalPages||1} onPage={setPage}/></>}
  </DataState>
 </div>;
}
