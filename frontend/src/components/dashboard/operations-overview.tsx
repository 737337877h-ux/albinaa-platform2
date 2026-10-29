'use client';
import Link from 'next/link';
import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {useCan,useMe} from '@/lib/auth';
import type {OracleInventorySummary} from '@/lib/oracle-inventory';
import type {ReservationSummary} from './types';
import {Card,CardHeader,Button} from '@/components/ui/primitives';

function State({query,children}:{query:UseQueryResult<any,Error>;children:React.ReactNode}) {
  if(query.isError)return <div role="alert" className="space-y-2 p-4"><p>تعذر قراءة الملخص؛ لا يعني ذلك عدم وجود نتائج.</p><Button variant="secondary" onClick={()=>void query.refetch()}>إعادة المحاولة</Button></div>;
  if(!query.data)return <p role="status" className="p-4 text-ink-mid">جارٍ قراءة الملخص…</p>;
  return <div className="space-y-3 p-4">{children}<p className="text-xs text-ink-mid">آخر قراءة: {new Date(query.dataUpdatedAt).toLocaleTimeString('ar-YE',{timeZone:'Asia/Aden'})}{query.isFetching?' — جارٍ التحديث':''}</p></div>;
}
export function OperationsOverview(){
  const can=useCan(),{data:me}=useMe();
  const inventoryAllowed=can('inventory.read'),reservationsAllowed=can('reservations.read'),hrAllowed=can('hr.requests.review'),ordersAllowed=can('sales_order_drafts.read'),attendanceAllowed=can('hr.attendance.read');
  const day=new Date(Date.now()+10800000).toISOString().slice(0,10);
  const attendance=useQuery({queryKey:['dashboard-operations','attendance',me?.id,day],queryFn:()=>api<{rows:Array<{status:string;needsReview:boolean}>}>(`/hr/attendance?date=${day}`),enabled:attendanceAllowed,staleTime:30000,refetchInterval:30000});
  const inventory=useQuery({queryKey:['dashboard-operations','inventory',me?.id],queryFn:()=>api<OracleInventorySummary>('/oracle-inventory/summary'),enabled:inventoryAllowed,staleTime:60000});
  const reservations=useQuery({queryKey:['reservations-summary'],queryFn:()=>api<ReservationSummary>('/reservations/summary'),enabled:reservationsAllowed,staleTime:60000});
  const requests=useQuery({queryKey:['dashboard-operations','hr-requests',me?.id],queryFn:()=>api<Array<{id:string;status:string;kind:string}>>('/hr/requests'),enabled:hrAllowed,staleTime:30000,refetchInterval:30000});
  const orders=useQuery({queryKey:['dashboard-operations','orders',me?.id],queryFn:()=>api<{total:number}>('/sales-order-drafts?status=ready_for_approval&limit=1'),enabled:ordersAllowed,staleTime:30000});
  if(!inventoryAllowed&&!reservationsAllowed&&!hrAllowed&&!ordersAllowed&&!can('hr.read')&&!attendanceAllowed&&!can('hr.tasks.manage')&&!can('hr.payroll.read'))return null;
  return <section aria-labelledby="operations-heading" className="space-y-3">
    <h2 id="operations-heading" className="font-display text-lg font-bold">ملخص الأقسام والطلبات</h2>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {attendanceAllowed&&<Card><CardHeader title="حضور اليوم" action={<Link href="/hr/attendance" className="text-sm underline">السجل</Link>}/><State query={attendance}><p>حضور مسجل: <strong>{attendance.data?.rows.filter(r=>r.status==='open'||r.status==='completed').length}</strong></p><p>إجازة معتمدة: <strong>{attendance.data?.rows.filter(r=>r.status==='leave').length}</strong></p><p>سجلات تحتاج مراجعة: <strong>{attendance.data?.rows.filter(r=>r.needsReview||r.status==='missing').length}</strong></p><p className="text-xs text-ink-mid">{day} — بتوقيت عدن. نقص التسجيل لا يثبت الغياب تلقائيًا.</p></State></Card>}
      {inventoryAllowed&&<Card><CardHeader title="حالة المخزون" action={<Link href="/inventory" className="text-sm underline">المخزون</Link>}/><State query={inventory}>{inventory.data&&<>{[['negative_stock','رصيد سالب'],['stockout_risk','خطر نفاد'],['reorder','تحتاج إعادة توريد']].map(([type,label])=><Link key={type} href={`/inventory/decisions/${type}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-3"><span>{label}</span><strong className="tnum">{inventory.data.classificationSummary?.find(c=>c.type===type)?.count??0}</strong></Link>)}<p className="text-xs text-ink-mid">تصنيفات مستقلة قد يتكرر الصنف بينها؛ لا تُجمع كعدد أصناف فريد.</p><p className="text-xs text-ink-mid">لقطة المخزون: {inventory.data.snapshot?.publishedAt?new Date(inventory.data.snapshot.publishedAt).toLocaleString('ar-YE'):'تاريخ النشر غير متاح'}</p></>}</State></Card>}
      {reservationsAllowed&&<Card><CardHeader title="حجوزات البضاعة" action={<Link href="/reservations" className="text-sm underline">الحجوزات</Link>}/><State query={reservations}><p>الحجوزات النشطة: <strong>{reservations.data?.activeCount}</strong></p><p>تنتهي خلال 7 أيام: <strong>{reservations.data?.expiringIn7Days}</strong></p><p>الكمية المحجوزة: <strong>{reservations.data?.totalTons} طن</strong></p></State></Card>}
      {hrAllowed&&<Card><CardHeader title="طلبات الموظفين" action={<Link href="/hr/requests" className="text-sm underline">المراجعة</Link>}/><State query={requests}><p>سلف بانتظار المراجعة: <strong>{requests.data?.filter(r=>r.status==='pending'&&r.kind==='advance').length}</strong></p><p>إجازات بانتظار المراجعة: <strong>{requests.data?.filter(r=>r.status==='pending'&&r.kind==='leave').length}</strong></p><p className="text-xs text-ink-mid">الموافقة على السلفة ليست إثبات صرف.</p></State></Card>}
      {ordersAllowed&&<Card><CardHeader title="طلبات العملاء" action={<Link href="/sales-order-drafts" className="text-sm underline">عرض الطلبات</Link>}/><State query={orders}><p>جاهزة للمراجعة: <strong className="tnum text-2xl">{orders.data?.total}</strong></p><p className="text-xs text-ink-mid">إجمالي الطلبات بحالة جاهز للمراجعة، وليس عدد سجلات الصفحة.</p></State></Card>}
    </div>
    <nav aria-label="اختصارات الموارد البشرية" className="flex flex-wrap gap-2">{[['hr.read','/hr/employees','الموظفون'],['hr.attendance.read','/hr/attendance','الحضور والانصراف'],['hr.tasks.manage','/hr/tasks','مهام الموظفين'],['hr.payroll.read','/hr/payroll','كشف الرواتب']].filter(([permission])=>can(permission)).map(([,href,label])=><Link key={href} href={href} className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2">{label}</Link>)}</nav>
  </section>;
}
