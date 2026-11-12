'use client';
import {useQuery} from '@tanstack/react-query';
import {useCan} from '@/lib/auth';
import {api} from '@/lib/api';
import {PageHeader} from '@/components/app-shell';
import {Button,Card} from '@/components/ui/primitives';
import {DataState} from '@/components/ui/data-state';
import {fmtDateTime} from '@/lib/format';
interface Readiness {currentSource:string;currentSourceYear:number|null;checkedAt:string;checks:{id:string;title:string;status:'ready'|'review';message:string;checkedAt?:string|null}[];}
export default function YearReadiness(){
 const can=useCan(),allowed=can('settings.manage'),query=useQuery({queryKey:['year-readiness'],queryFn:()=>api<Readiness>('/oracle-monitoring/year-readiness'),enabled:allowed});
 if(!allowed)return <Card className="p-5">يلزم امتلاك صلاحية إدارة الإعدادات.</Card>;
 return <div className="space-y-5"><PageHeader title="الاستعداد لسنة 2027" action={<Button disabled={query.isFetching} onClick={()=>void query.refetch()}>إعادة الفحص</Button>}/>
  <Card className="space-y-3 p-5"><p className="font-bold">الانتقال يحتاج اعتماد المصدر الجديد ومطابقة الأرصدة.</p><p>هذه قائمة فحص للقراءة فقط. اعتماد الانتقال خطوة مستقلة بعد اكتمال البنود.</p></Card>
  <DataState isLoading={query.isLoading} isError={query.isError} isFetching={query.isFetching} error={query.error} onRetry={()=>void query.refetch()} isEmpty={false}>
   {query.data&&<><p>المصدر الحالي: {query.data.currentSource} • سنة المصدر: {query.data.currentSourceYear??'غير محددة'} • الفحص: {fmtDateTime(query.data.checkedAt)}</p><div className="grid gap-4 lg:grid-cols-2">{query.data.checks.map(check=><Card className="space-y-3 p-5" key={check.id}><div className="flex items-center justify-between gap-3"><h2 className="font-bold">{check.title}</h2><span className={check.status==='ready'?'text-pine-700':'text-hazard-700'}>{check.status==='ready'?'تم التحقق':'يلزم مراجعة'}</span></div><p>{check.message}</p>{check.checkedAt&&<p className="text-sm text-concrete-500">وقت اللقطة: {fmtDateTime(check.checkedAt)}</p>}</Card>)}</div></>}
  </DataState>
 </div>;
}
