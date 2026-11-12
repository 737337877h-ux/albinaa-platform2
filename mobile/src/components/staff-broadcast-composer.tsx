import React from 'react';
import {Alert,Modal,ScrollView,Text,TextInput,TouchableOpacity} from 'react-native';
import {getClient} from '../api/client';
import {generateIdempotencyKey} from '../utils/constants';
import {colors} from '../theme';
export default function StaffBroadcastComposer({onClose}:{onClose:()=>void}){
 const [title,setTitle]=React.useState(''),[message,setMessage]=React.useState(''),[count,setCount]=React.useState<number|null>(null),[busy,setBusy]=React.useState(false);
 const pending=React.useRef<{operationId:string;title:string;message:string}|null>(null);
 React.useEffect(()=>{let live=true;void getClient().then(c=>c.get('/employee-messages/recipients')).then(r=>{if(live)setCount(r.data.count);}).catch(()=>{if(live)Alert.alert('تعذر تحميل المستلمين','تحقق من الاتصال وصلاحية الإرسال.');});return()=>{live=false;};},[]);
 async function send(){
  pending.current??={operationId:generateIdempotencyKey(),title:title.trim(),message:message.trim()};
  setBusy(true);
  try{const {data}=await(await getClient()).post('/employee-messages/broadcast',pending.current,{headers:{'Idempotency-Key':pending.current.operationId}});Alert.alert('تم تجهيز الرسالة',`أُدرجت الرسالة في إشعارات ${data.queued} موظفًا.`);onClose();}
  catch(error:any){Alert.alert('تعذر تأكيد الإرسال',error?.response?.data?.message||'أعد المحاولة لإرسال الرسالة نفسها.');}finally{setBusy(false);}
 }
 return <Modal visible animationType="slide" onRequestClose={()=>!busy&&onClose()}><ScrollView contentContainerStyle={{padding:22,gap:16}} keyboardShouldPersistTaps="handled">
  <Text style={{fontFamily:'TajawalBold',fontSize:23,textAlign:'right'}}>رسالة جماعية للموظفين</Text>
  <Text style={{textAlign:'right'}}>{count===null?'جارٍ التحقق من المستلمين...':`جميع مستخدمي المنشأة النشطين: ${count}`}</Text>
  <TextInput editable={!pending.current&&!busy} value={title} onChangeText={setTitle} maxLength={120} placeholder="عنوان الرسالة" textAlign="right" style={{padding:14,borderWidth:1,borderColor:colors.line,borderRadius:12}}/>
  <TextInput editable={!pending.current&&!busy} value={message} onChangeText={setMessage} maxLength={2000} multiline placeholder="نص الرسالة" textAlign="right" style={{padding:14,borderWidth:1,borderColor:colors.line,borderRadius:12,minHeight:180}}/>
  <TouchableOpacity disabled={busy||!count||title.trim().length<3||message.trim().length<3} onPress={()=>Alert.alert('تأكيد إرسال الرسالة',`ستظهر الرسالة لـ${count} موظفًا. هل تريد إرسالها؟`,[{text:'إلغاء',style:'cancel'},{text:pending.current?'إعادة المحاولة':'إرسال للجميع',onPress:()=>void send()}])} style={{padding:16,borderRadius:12,backgroundColor:colors.primary,opacity:busy?0.5:1}}><Text style={{color:'#fff',textAlign:'center',fontFamily:'TajawalBold'}}>{busy?'جارٍ الإرسال...':pending.current?'إعادة المحاولة':'إرسال الرسالة'}</Text></TouchableOpacity>
  <TouchableOpacity disabled={busy} onPress={onClose}><Text style={{textAlign:'center',padding:14}}>إلغاء</Text></TouchableOpacity>
 </ScrollView></Modal>;
}
