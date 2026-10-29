'use client';
import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {Button} from '@/components/ui/primitives';
import {createRequestId} from '@/lib/request-id';
type Label={itemCode:string;itemName:string;widthMm:number;heightMm:number;copies:number;showName:boolean;showCode:boolean};
type Job={id:string;status:string;payload:Label;created_at:string};
const states:Record<string,string>={queued:'بانتظار الطابعة',dispatching:'جارٍ الإرسال',submitted:'أُرسل إلى طابور Windows',failed:'فشل التجهيز',unknown:'حالة غير مؤكدة؛ افحص الطابعة قبل إعادة الطلب'};
export function BarcodePlatformPrint({label}:{label:Label|null}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<{operationId:string;label:Label}|null>(null);
 const printer=useQuery<{name:string;available:boolean}>({queryKey:['barcode-printer'],queryFn:()=>api('/barcode-print/printer'),refetchInterval:10000});
 const jobs=useQuery<Job[]>({queryKey:['barcode-jobs'],queryFn:()=>api('/barcode-print/jobs'),refetchInterval:5000});
 async function send(){
  if(busy||!label)return;setBusy(true);setError('');
  // Preserve the exact request after an ambiguous network failure, even if inputs change.
  pending.current??={operationId:createRequestId(),label:{...label}};
  try{await api('/barcode-print/jobs',{method:'POST',body:JSON.stringify({operationId:pending.current.operationId,...pending.current.label})});pending.current=null;await jobs.refetch();}
  catch(e:any){setError(e.message||'تعذر الإرسال');if(e.status>=400&&e.status<500)pending.current=null;}
  finally{setBusy(false);}
 }
 return <section className="mt-4 space-y-3 rounded-lg border border-line p-3">
  <p className="font-semibold">الطباعة عبر المنصة</p>
  <p className="text-xs">{printer.data?.name??'ZDesigner GK888t (EPL)'} · {printer.data?.available?'خدمة الطباعة متصلة':'خدمة الطباعة غير متصلة؛ الطلب سيبقى في الانتظار'}</p>
  <Button className="w-full" disabled={!label||busy||printer.isError} onClick={()=>void send()}>{busy?'جارٍ إرسال الطلب…':pending.current?'إعادة إرسال نفس الطلب':'إرسال للطابعة'}</Button>
  <p className="text-xs text-ink-mid">حتى 100 نسخة للطلب. الإرسال إلى Windows لا يؤكد خروج الورق؛ تأكد من الورق والطابعة.</p>
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
  {jobs.isError&&<p role="alert">تعذر قراءة سجل الطباعة.</p>}
  <div className="max-h-56 space-y-2 overflow-auto">{jobs.data?.map(job=><div key={job.id} className="border-t border-line pt-2 text-xs"><p>{job.payload.itemName} · {job.payload.copies} نسخة</p><p>{states[job.status]??job.status}</p><span>{new Date(job.created_at).toLocaleString('ar')}</span></div>)}</div>
 </section>;
}
