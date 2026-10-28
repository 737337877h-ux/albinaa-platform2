import React from 'react';
import {Alert} from 'react-native';
import {getClient} from '../api/client';
import {useAuth} from '../store/auth-context';
import {HrTaskFilePicker,HrTaskLocalFile,taskFileId,uploadTaskFile} from '../components/hr-task-files';
import {ToolButton,ToolCard,ToolCheck,ToolField,ToolPage,ToolState,ToolText,useToolAction,useToolData} from '../components/native-tools';
import {parseFlexibleDate} from '../utils/date-input';
type Employee={id:string;employeeNo:string;fullName:string;loginUserId:string|null};
type Payload={id:string;title:string;description:string;dueDate:string;employeeIds:string[];attachmentIds:string[]};
export default function AssignHrTask({navigation}:any){
 const {user}=useAuth(),allowed=!!user?.permissions.includes('hr.tasks.manage');
 const q=useToolData<{today:string;employees:Employee[]}>('/hr/tasks',allowed),action=useToolAction();
 const [title,setTitle]=React.useState(''),[description,setDescription]=React.useState(''),[date,setDate]=React.useState(''),[search,setSearch]=React.useState(''),[ids,setIds]=React.useState<string[]>([]),[files,setFiles]=React.useState<HrTaskLocalFile[]>([]),[retry,setRetry]=React.useState(false);
 const operation=React.useRef(taskFileId()); const pending=React.useRef<{payload:Payload;files:HrTaskLocalFile[]}|null>(null);
 React.useEffect(()=>{if(q.data?.today&&!date)setDate(q.data.today);},[q.data?.today]);
 const locked=action.busy||retry;
 async function submit(){if(!allowed)return;const parsed=parseFlexibleDate(date);if(!pending.current&&(!parsed||title.trim().length<3||!ids.length)){Alert.alert('راجع البيانات','اكتب عنوانًا واضحًا وتاريخًا صحيحًا واختر موظفًا واحدًا على الأقل.');return;}
 const result=await action.run(async()=>{
  pending.current??={payload:{id:operation.current,title:title.trim(),description:description.trim(),dueDate:parsed!.iso,employeeIds:[...ids],attachmentIds:files.map(f=>f.id)},files:files.map(f=>({...f}))};setRetry(true);
  const request=pending.current;for(const f of request.files){if(!f.uploaded){await uploadTaskFile(f,request.payload.id,'instruction');f.uploaded=true;}}
  return (await (await getClient()).post('/hr/tasks',request.payload)).data;
 });
 if(!result.ok&&'error' in result&&[400,403,404,422].includes((result.error as any)?.response?.status)){pending.current=null;setRetry(false);}
 if(result.ok){operation.current=taskFileId();pending.current=null;setRetry(false);setTitle('');setDescription('');setIds([]);setFiles([]);Alert.alert('أُرسلت المهمة','أُسندت المهمة إلى الموظفين المحددين وأُضيفت إشعاراتها.');}
 }
 return <ToolPage title="إسناد مهمة لموظف" onRefresh={()=>void q.refetch()} refreshing={q.isRefetching}>{!allowed?<ToolText>لا تملك صلاحية إسناد مهام الموظفين.</ToolText>:<><ToolState query={q}/><ToolCard><ToolField label="عنوان المهمة" value={title} onChangeText={setTitle} editable={!locked} maxLength={200}/><ToolField label="تفاصيل المطلوب" value={description} onChangeText={setDescription} editable={!locked} multiline maxLength={4000}/><ToolField label="موعد الإنجاز (يوم/شهر/سنة)" value={date} onChangeText={setDate} editable={!locked}/><HrTaskFilePicker purpose="instruction" files={files} onChange={setFiles} disabled={locked}/></ToolCard><ToolCard><ToolText title>الموظفون — المحددون: {ids.length}</ToolText><ToolField label="بحث عن موظف" value={search} onChangeText={setSearch}/>{q.data?.employees.filter(e=>`${e.employeeNo} ${e.fullName}`.includes(search)).map(e=><ToolCheck key={e.id} label={`${e.employeeNo} — ${e.fullName}${e.loginUserId?'':' (غير مرتبط بحساب دخول)'}`} checked={ids.includes(e.id)} disabled={locked||!e.loginUserId} onChange={v=>setIds(old=>v?[...old,e.id]:old.filter(id=>id!==e.id))}/>)}{q.data&&!q.data.employees.length&&<ToolText>لا يوجد موظفون نشطون.</ToolText>}</ToolCard>{retry&&<ToolText>أعد تأكيد الإرسال بالإعدادات نفسها لمنع تكرار المهمة. تبقى المرفقات محفوظة أثناء المحاولة.</ToolText>}<ToolButton title={action.busy?'جارٍ الإرسال…':retry?'إعادة تأكيد إرسال المهمة':'إرسال المهمة للموظفين المحددين'} disabled={action.busy||(!retry&&(q.isError||!ids.length||title.trim().length<3))} onPress={()=>void submit()}/><ToolButton title="مراجعة مهام الموظفين" onPress={()=>navigation.navigate('HrTaskReview')}/></>}</ToolPage>;
}
