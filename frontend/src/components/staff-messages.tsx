'use client';
import {useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useCan,useMe} from '@/lib/auth';
import {api} from '@/lib/api';
import {createRequestId} from '@/lib/request-id';
import {Dialog} from './ui/dialog';
import {Button} from './ui/primitives';
import {toast} from './ui/toast';

export function StaffMessagePopup(){
 const me=useMe(),qc=useQueryClient();
 const q=useQuery({queryKey:['staff-popup',me.data?.id],queryFn:()=>api<{items:{id:string;payload:{title:string;message:string}}[]}>('/notifications?kind=staff_broadcast&unreadOnly=true&limit=1'),enabled:!!me.data,refetchInterval:20000,refetchIntervalInBackground:false});
 const current=q.data?.items[0];
 const read=useMutation({mutationFn:()=>api(`/notifications/${current!.id}/read`,{method:'PATCH'}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['staff-popup']});void qc.invalidateQueries({queryKey:['notifications']});},onError:(error:Error)=>toast(error.message,'err')});
 return <Dialog open={!!me.data&&!!current} onClose={()=>{if(!read.isPending)read.mutate();}} title={current?.payload.title||'رسالة من الإدارة'}><p className="max-h-[55vh] overflow-auto whitespace-pre-wrap text-lg leading-8">{current?.payload.message}</p><Button disabled={read.isPending} onClick={()=>read.mutate()} className="mt-5">تم الاطلاع</Button></Dialog>;
}

export function StaffBroadcastButton(){
 const can=useCan(),[open,setOpen]=useState(false);
 if(!can('notifications.broadcast'))return null;
 return <><Button variant="secondary" onClick={()=>setOpen(true)}>رسالة جماعية للموظفين</Button>{open&&<BroadcastComposer close={()=>setOpen(false)}/>}</>;
}
function BroadcastComposer({close}:{close:()=>void}){
 const [title,setTitle]=useState(''),[message,setMessage]=useState('');
 const pending=useRef<{operationId:string;title:string;message:string}|null>(null);
 const recipients=useQuery({queryKey:['staff-message-recipients'],queryFn:()=>api<{count:number}>('/employee-messages/recipients')});
 const send=useMutation({mutationFn:()=>{pending.current??={operationId:createRequestId(),title:title.trim(),message:message.trim()};return api<{queued:number}>('/employee-messages/broadcast',{method:'POST',body:JSON.stringify(pending.current),headers:{'Idempotency-Key':pending.current.operationId}});},onSuccess:result=>{toast(`أُدرجت الرسالة في إشعارات ${result.queued} موظفًا`,'ok');close();},onError:(error:Error)=>toast(error.message,'err')});
 return <Dialog open onClose={()=>{if(!send.isPending)close();}} title="رسالة جماعية للموظفين"><div className="space-y-4"><p>{recipients.data?`جميع مستخدمي المنشأة النشطين: ${recipients.data.count}`:'جارٍ التحقق من المستلمين...'}</p><input aria-label="عنوان الرسالة" className="w-full rounded-xl border border-line bg-surface-0 p-3" disabled={send.isPending||!!pending.current} maxLength={120} placeholder="عنوان الرسالة" value={title} onChange={e=>setTitle(e.target.value)}/><textarea aria-label="نص الرسالة" className="min-h-40 w-full rounded-xl border border-line bg-surface-0 p-3" disabled={send.isPending||!!pending.current} maxLength={2000} placeholder="نص الرسالة" value={message} onChange={e=>setMessage(e.target.value)}/><Button disabled={send.isPending||!recipients.data?.count||title.trim().length<3||message.trim().length<3} onClick={()=>{if(window.confirm(`إرسال الرسالة إلى ${recipients.data?.count} موظفًا؟`))send.mutate();}}>{send.isPending?'جارٍ الإرسال...':pending.current?'إعادة المحاولة':'إرسال للجميع'}</Button></div></Dialog>;
}
