'use client';
import NextImage from 'next/image';
import {useState} from 'react';
import {api} from '@/lib/api';
import {createRequestId} from '@/lib/request-id';
import {Button,Input} from '@/components/ui/primitives';
import {Dialog} from '@/components/ui/dialog';
import {toast} from '@/components/ui/toast';
export type TaskAttachment={id:string;name:string;mime:string;size:number;createdAt?:string;submissionVersion?:number|null};
export type TaskAttachmentDraft=TaskAttachment&{file:File;state:'pending'|'ready'|'error'};
export function TaskAttachmentPicker({targetId,purpose,files,setFiles,disabled=false}:{targetId:string;purpose:'instruction'|'completion';files:TaskAttachmentDraft[];setFiles:React.Dispatch<React.SetStateAction<TaskAttachmentDraft[]>>;disabled?:boolean}){
 const [uploading,setUploading]=useState(false);
 async function upload(list:TaskAttachmentDraft[]){setUploading(true);try{for(const item of list){const body=new FormData();body.append('id',item.id);body.append('purpose',purpose);body.append('targetId',targetId);body.append('file',item.file);try{const result=await api<TaskAttachment>('/hr/tasks/attachments',{method:'POST',body});setFiles(old=>old.map(f=>f.id===item.id?{...f,...result,state:'ready'}:f));}catch(e){setFiles(old=>old.map(f=>f.id===item.id?{...f,state:'error'}:f));toast((e as Error).message,'err');}}}finally{setUploading(false);}}
 return <div className="space-y-2"><p>مرفقات اختيارية — صور أو PDF أو Excel؛ حتى 5 ملفات، 10 ميجابايت للملف.</p><Input aria-label="اختيار مرفقات المهمة" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx" disabled={disabled||uploading||files.length>=5} onChange={e=>{const picked=Array.from(e.target.files??[]);e.target.value='';if(picked.length+files.length>5||picked.some(f=>f.size>10*1024*1024)){toast('الحد الأقصى 5 ملفات؛ 10 ميجابايت للملف','err');return;}const added=picked.map(file=>({id:createRequestId(),name:file.name,mime:file.type,size:file.size,file,state:'pending' as const}));setFiles(old=>[...old,...added]);void upload(added);}}/>{files.map(f=><div key={f.id} className="flex flex-wrap items-center gap-2"><span className="break-all">{f.name} — {f.state==='ready'?'جاهز للإرسال':f.state==='pending'?'جارٍ الرفع':'تعذر الرفع'}</span>{f.state==='error'&&<Button disabled={disabled||uploading} onClick={()=>void upload([f])}>إعادة رفع الملف</Button>}<Button variant="secondary" disabled={disabled||uploading} onClick={async()=>{try{await api('/hr/tasks/attachments/'+f.id,{method:'DELETE'});}catch(e){if(f.state==='ready'){toast((e as Error).message,'err');return;}}setFiles(old=>old.filter(x=>x.id!==f.id));}}>إزالة</Button></div>)}</div>;
}
export function TaskAttachmentList({files,title}:{files?:TaskAttachment[];title:string}){
 const [preview,setPreview]=useState<{name:string;uri:string}|null>(null),[loading,setLoading]=useState<string|null>(null);
 async function open(f:TaskAttachment){setLoading(f.id);try{const d=await api<{name:string;mime:string;base64:string}>('/hr/tasks/attachments/'+f.id);if(d.mime.startsWith('image/'))setPreview({name:d.name,uri:`data:${d.mime};base64,${d.base64}`});else {const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0))],{type:d.mime}));const a=document.createElement('a');a.href=url;a.download=d.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(e){toast((e as Error).message,'err');}finally{setLoading(null);}}
 if(!files?.length)return null;
 return <section className="space-y-2 rounded border p-3"><h3 className="font-bold">{title}</h3><div className="flex flex-wrap gap-2">{files.map(f=><Button key={f.id} variant="secondary" disabled={loading!==null} onClick={()=>void open(f)}>{loading===f.id?'جارٍ الفتح…':f.mime.startsWith('image/')?'عرض الصورة':'تنزيل الملف'}: {f.name}{f.createdAt?' — '+new Date(f.createdAt).toLocaleString('ar-YE'):''}</Button>)}</div><Dialog open={!!preview} onClose={()=>setPreview(null)} title={preview?.name??'المرفق'}>{preview&&<NextImage unoptimized width={1200} height={900} src={preview.uri} alt={preview.name} className="max-h-[75vh] w-full object-contain"/>}</Dialog></section>;
}
