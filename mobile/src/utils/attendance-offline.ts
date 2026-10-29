import {getClient} from '../api/client';
import {attendanceRows,attendanceResult,getMeta,setMeta} from '../db/database';
export const attendanceCacheKey=(scope:string)=>`attendance-snapshot:${scope}`;
export const actionField:Record<string,string>={in:'checkIn',out:'checkOut',break_out:'breakOut',break_in:'breakIn'};
export function projectAttendance(snapshot:any,rows:any[]){
 if(!snapshot)return null;
 const data=JSON.parse(JSON.stringify(snapshot));
 const ops=new Set(data.records.flatMap((r:any)=>[r.inOperationId,r.outOperationId,r.breakOutOperationId,r.breakInOperationId]));
 for(const row of rows){
  const p=JSON.parse(row.payload);if(ops.has(p.operationId)||row.status==='rejected'||row.status==='synced')continue;
  if(p.employeeId&&data.employee?.id&&p.employeeId!==data.employee.id)continue;
  const stamp=new Date(p.recordedAt).toISOString();
  if(p.action==='in'){
   const r={id:p.operationId,checkIn:stamp,workDate:stamp,schedule:{fourPunches:true},inEvidence:{method:p.method},local:true};
   data.records.unshift(r);data.open=r;
  }else if(data.open){data.open[actionField[p.action]]=stamp;const r=data.records.find((x:any)=>x.id===data.open.id);if(r)r[actionField[p.action]]=stamp;if(p.action==='out')data.open=null;}
 }
 return data;
}
let running:Promise<void>|null=null;
export function syncAttendance(){
 if(running)return running;
 running=run().finally(()=>{running=null;});return running;
}
async function run(){
 const scope=await getMeta('dataOwner');if(!scope)return;
 const rows=await attendanceRows(scope);if(!rows.some(r=>r.status!=='synced'))return;
 const client=await getClient();
 for(const row of rows){
  if(row.status==='synced')continue;
  if(row.status==='rejected')break;
  if(await getMeta('dataOwner')!==scope)return;
  try{
   const response=await client.post('/hr/attendance',JSON.parse(row.payload),{timeout:30000});
   if(!response.data?.id)throw Error('تعذر تأكيد التسجيل');
   const raw=await getMeta(attendanceCacheKey(scope));
   if(raw&&await getMeta('dataOwner')===scope){
    const snapshot=JSON.parse(raw),record=response.data;
    snapshot.records=[record,...snapshot.records.filter((r:any)=>r.id!==record.id)];
    snapshot.open=record.checkOut?null:record;
    await setMeta(attendanceCacheKey(scope),JSON.stringify(snapshot));
   }
   await attendanceResult(row.operationId,'synced');
  }catch(e:any){
   const status=e.response?.status;
   const retry=!status||[401,408,425,429].includes(status)||status>=500;
   await attendanceResult(row.operationId,retry?'pending':'rejected',e.response?.data?.message?.toString()||e.message||'تعذر الاتصال');
   break; // Preserve the order of in, break-out, break-in and out.
  }
 }
 try{const r=await client.get('/hr/attendance/mine');if(await getMeta('dataOwner')===scope)await setMeta(attendanceCacheKey(scope),JSON.stringify(r.data));}catch{/* Keep the durable local projection. */}
}
