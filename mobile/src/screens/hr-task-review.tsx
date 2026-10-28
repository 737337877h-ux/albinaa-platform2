import React from 'react';
import {ActivityIndicator,Alert,ScrollView,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useQuery} from '@tanstack/react-query';
import {useFocusEffect} from '@react-navigation/native';
import {getClient} from '../api/client';
import {useAuth} from '../store/auth-context';
import {HrTaskFileList} from '../components/hr-task-files';
const newOperationId=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16);});
import {colors} from '../theme';
export default function HrTaskReview({route}:any){
 const {user}=useAuth(),allowed=user?.permissions?.includes('hr.tasks.manage');
 const [target,setTarget]=React.useState(route?.params?.assignmentId),[selected,setSelected]=React.useState<any>(null),[note,setNote]=React.useState(''),[rating,setRating]=React.useState(5),[busy,setBusy]=React.useState(false);
 const pending=React.useRef<any>(null),lock=React.useRef(false);
 React.useEffect(()=>{setTarget(route?.params?.assignmentId);},[route?.params?.assignmentId]);
 const q=useQuery({queryKey:['hr-task-review',user?.id],enabled:!!allowed,queryFn:async()=>(await (await getClient()).get('/hr/tasks')).data,retry:false,refetchInterval:15000});
 useFocusEffect(React.useCallback(()=>{if(allowed)void q.refetch();},[allowed,q.refetch]));
 const action=async(kind:'complete'|'return')=>{if(lock.current||!selected)return;if(note.trim().length<3)return Alert.alert('ملاحظات المراجعة','اكتب نتيجة المراجعة');lock.current=true;setBusy(true);
  try{pending.current??={operationId:newOperationId(),action:kind,version:selected.version,note:note.trim(),...(kind==='complete'?{rating}:{})};await(await getClient()).put(`/hr/tasks/${selected.id}/action`,pending.current);pending.current=null;setSelected(null);await q.refetch();Alert.alert('تم حفظ المراجعة');}
  catch(e:any){if(e.response?.status>=400&&e.response.status<500)pending.current=null;Alert.alert('تعذر حفظ المراجعة',e.response?.data?.message?.toString()||'تحقق من الاتصال وأعد المحاولة؛ لن تتكرر العملية.');}
  finally{setBusy(false);lock.current=false;}
 };
 const button=(text:string,fn:()=>void)=><TouchableOpacity key={text} accessibilityRole="button" disabled={busy} onPress={fn} style={s.button}><Text style={s.white}>{text}</Text></TouchableOpacity>;
 if(!allowed)return <SafeAreaView style={s.page}><Text style={s.text}>لا تملك صلاحية مراجعة مهام الموظفين.</Text></SafeAreaView>;
 const rows=(q.data?.tasks??[]).flatMap((task:any)=>task.assignments.map((a:any)=>({...a,task}))).filter((a:any)=>target?a.id===target:a.status==='submitted');
 return <SafeAreaView edges={['bottom']} style={s.page}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text style={s.title}>مراجعة إنجاز مهام الموظفين</Text>{button('كل المهام بانتظار المراجعة',()=>{setTarget(undefined);void q.refetch();})}{q.isLoading&&<ActivityIndicator/>}{q.isError&&<Text style={s.text}>تعذر تحديث المهام؛ تحقق من الاتصال.</Text>}
 {rows.map((a:any)=><View style={s.card} key={a.id}><Text style={s.title}>{a.task.title}</Text><Text style={s.text}>{a.employee.fullName} — {a.task.dueDate.slice(0,10)}</Text><Text style={s.text}>{a.task.description}</Text><HrTaskFileList files={a.task.attachments} title="مرفقات المهمة"/><Text style={s.text}>{a.completionNote||'لم يرسل الموظف إفادة إنجاز بعد.'}</Text><HrTaskFileList files={a.attachments} title="مرفقات الإنجاز"/>{a.reviewNote&&<Text style={s.text}>نتيجة المراجعة: {a.reviewNote}</Text>}{a.rating!=null&&<Text style={s.text}>التقييم: {a.rating} / 5</Text>}
 {a.status==='submitted'&&a.employee.loginUserId!==user?.id&&!q.isError&&button('مراجعة هذا الإنجاز',()=>{setSelected(a);setNote('');setRating(5);pending.current=null;})}
 {selected?.id===a.id&&<View style={s.content}><TextInput accessibilityLabel="ملاحظات المراجعة" multiline value={note} onChangeText={setNote} editable={!busy&&!pending.current} placeholder="نتيجة المراجعة أو سبب الإعادة" style={s.input}/><Text style={s.text}>التقييم من 5: {rating}</Text><View style={s.row}>{[1,2,3,4,5].map(n=>button(String(n),()=>{if(!pending.current)setRating(n);}))}</View>{pending.current?button('إعادة تأكيد المراجعة',()=>void action(pending.current.action)):<>{button('اعتماد الإنجاز',()=>void action('complete'))}{button('إعادة للموظف',()=>void action('return'))}</>}</View>}
 </View>)}{!q.isLoading&&!q.isError&&!rows.length&&<Text style={s.text}>لا توجد مهمة متاحة ضمن العرض المختار.</Text>}</ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:colors.background},content:{padding:16,gap:12},card:{padding:16,gap:10,borderRadius:12,backgroundColor:'#fff'},row:{flexDirection:'row',gap:8},title:{fontFamily:'TajawalBold',fontSize:18,textAlign:'right',color:colors.primary},text:{fontFamily:'TajawalRegular',fontSize:15,textAlign:'right',color:colors.ink},button:{padding:12,backgroundColor:colors.primary,borderRadius:8},white:{color:'#fff',textAlign:'center',fontFamily:'TajawalBold'},input:{minHeight:110,padding:12,borderWidth:1,borderColor:colors.line,textAlign:'right',textAlignVertical:'top',fontFamily:'TajawalRegular',color:colors.ink}});
