import React from 'react';
import {Alert,Modal,ScrollView,Text,TextInput,TouchableOpacity,View} from 'react-native';
import {enqueueMutation,getDb} from '../db/database';
import {getClient} from '../api/client';
import {generateIdempotencyKey} from '../utils/constants';
import {parseFlexibleDate} from '../utils/date-input';
import {useSync} from '../store/sync-context';
import {colors} from '../theme';

const results=[['contacted','تواصل ناجح'],['no_answer','لا يرد'],['needs_visit','يحتاج زيارة'],['deferred','مؤجل'],['note','ملاحظة']] as const;
export default function TaskCompletionSheet({task,onClose,onDone}:{task:any;onClose:()=>void;onDone:()=>void}){
 const [result,setResult]=React.useState(''),[notes,setNotes]=React.useState(''),[next,setNext]=React.useState(''),[busy,setBusy]=React.useState(false);
 const {triggerSync}=useSync();
 const operation=React.useRef(generateIdempotencyKey());
 async function submit(){
  if(!result)return Alert.alert('اختر النتيجة','حدد نتيجة المتابعة قبل إتمام المهمة.');
  const parsed=next.trim()?parseFlexibleDate(next):null;
  if(next.trim()&&!parsed)return Alert.alert('التاريخ غير صحيح','راجع موعد المتابعة القادمة.');
  const payload={result,notes:notes.trim()||undefined,nextFollowupDate:parsed?.iso};
  setBusy(true);
  try{
   let offline=false;
   try{await (await getClient()).post(`/tasks/${task.id}/complete`,payload,{headers:{'Idempotency-Key':operation.current}});}
   catch(error:any){if(error?.response)throw error;offline=true;await enqueueMutation(operation.current,'POST',`/tasks/${task.id}/complete`,payload);}
   await (await getDb()).runAsync('UPDATE tasks SET status=? WHERE id=?',offline?'pending_completion':'done',task.id);
   onDone();onClose();void triggerSync();
   Alert.alert(offline?'حُفظ الإنجاز محليًا':'تم إتمام المهمة',offline?'سيُرسل عند عودة الاتصال ويخضع للتحقق من صلاحيتك وحالة المهمة.':'حُفظت نتيجة المتابعة مع المهمة.');
  }catch(error:any){Alert.alert('تعذر إتمام المهمة',error?.response?.data?.message||error.message||'أعد المحاولة');}finally{setBusy(false);}
 }
 return <Modal visible={!!task} animationType="slide" onRequestClose={()=>!busy&&onClose()}><ScrollView contentContainerStyle={{padding:22,gap:16}} keyboardShouldPersistTaps="handled">
  <Text style={{fontSize:23,fontFamily:'TajawalBold',textAlign:'right'}}>إتمام المهمة</Text>
  <Text style={{textAlign:'right',fontFamily:'TajawalRegular'}}>{task.customerName||task.customer?.name||'متابعة العميل'}</Text>
  <Text style={{textAlign:'right'}}>اختر النتيجة الفعلية للتواصل</Text>
  <View style={{flexDirection:'row-reverse',flexWrap:'wrap',gap:8}}>{results.map(([id,label])=><TouchableOpacity key={id} onPress={()=>setResult(id)} disabled={busy} style={{padding:12,borderWidth:1,borderColor:colors.primary,borderRadius:12,backgroundColor:result===id?colors.primary:'#fff'}}><Text style={{color:result===id?'#fff':colors.primary,fontFamily:'TajawalBold'}}>{label}</Text></TouchableOpacity>)}</View>
  <TextInput value={notes} onChangeText={setNotes} placeholder="ملاحظات النتيجة" multiline maxLength={2000} textAlign="right" style={{borderWidth:1,borderColor:colors.line,borderRadius:12,padding:14,minHeight:100}}/>
  <TextInput value={next} onChangeText={setNext} placeholder="موعد متابعة قادم (اختياري)" keyboardType="number-pad" textAlign="right" style={{borderWidth:1,borderColor:colors.line,borderRadius:12,padding:14}}/>
  <TouchableOpacity disabled={busy||!result} onPress={submit} style={{padding:16,borderRadius:12,backgroundColor:colors.primary,opacity:busy||!result?.length?0.5:1}}><Text style={{color:'#fff',textAlign:'center',fontFamily:'TajawalBold'}}>{busy?'جارٍ الحفظ...':'حفظ النتيجة وإتمام المهمة'}</Text></TouchableOpacity>
  <TouchableOpacity disabled={busy} onPress={onClose}><Text style={{textAlign:'center',padding:14}}>إلغاء</Text></TouchableOpacity>
 </ScrollView></Modal>;
}
