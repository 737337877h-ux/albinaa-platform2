import React from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { getClient } from '../api/client';
import { useAuth } from '../store/auth-context';
import { colors } from '../theme';
import {parseFlexibleDate} from '../utils/date-input';

const labels:Record<string,string>={pending:'بانتظار المراجعة',approved:'موافق عليه',rejected:'مرفوض',cancelled:'ملغى'};
const leaves:Record<string,string>={annual:'سنوية',sick:'مرضية',unpaid:'بدون راتب',other:'أخرى'};
// A deduplication key only; authorization always comes from the signed-in account.
const newId=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16);});
export default function HrRequestsScreen({route}:any){
 const {user}=useAuth();
 const [kind,setKind]=React.useState('advance'),[amount,setAmount]=React.useState(''),[currency,setCurrency]=React.useState('YER'),[reason,setReason]=React.useState(''),[startDate,setStart]=React.useState(''),[endDate,setEnd]=React.useState(''),[leaveType,setLeave]=React.useState('annual'),[busy,setBusy]=React.useState(false);
 const pending=React.useRef<any>(null);
 const scroll=React.useRef<ScrollView>(null),focused=React.useRef<TextInput|null>(null);
 const inputRefs=React.useRef<Record<string,TextInput|null>>({}),scrollY=React.useRef(0);
 const [keyboardVisible,setKeyboardVisible]=React.useState(false);
 const headerHeight=useHeaderHeight();
  const revealInput=React.useCallback(()=>{
  const field=focused.current,viewport=scroll.current;if(!field||!viewport)return;
  field.measureInWindow((_x,y,_w,h)=>viewport.getNativeScrollRef()?.measureInWindow((_sx,top,_sw,height)=>{
   if(focused.current!==field||height<=0)return;
   const overflow=y+h-(top+height-24);
   if(overflow>0)viewport.scrollTo({y:Math.max(0,scrollY.current+overflow),animated:true});
   else if(y<top+12)viewport.scrollTo({y:Math.max(0,scrollY.current+y-top-12),animated:true});
  }));
 },[]);
 React.useEffect(()=>{
  const show=Keyboard.addListener('keyboardDidShow',()=>{setKeyboardVisible(true);requestAnimationFrame(revealInput);});
  const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardVisible(false));
  return ()=>{show.remove();hide.remove();};
 },[revealInput]);
 const q=useQuery({queryKey:['hr-requests',user?.id],queryFn:async()=>(await (await getClient()).get('/hr/requests/mine')).data,retry:false,refetchInterval:5000});
 useFocusEffect(React.useCallback(()=>{void q.refetch();},[q.refetch]));
 const send=async()=>{
  if(busy)return;
  if(!pending.current){
   if(reason.trim().length<3)return Alert.alert('راجع الطلب','اكتب سبب الطلب');
   if(kind==='advance'&&(!/^\d{1,12}(\.\d{1,2})?$/.test(amount)||Number(amount)<=0))return Alert.alert('راجع الطلب','أدخل مبلغًا صحيحًا أكبر من صفر بالأرقام الإنجليزية');
   const from=parseFlexibleDate(startDate),to=parseFlexibleDate(endDate);
   if(kind==='leave'&&(!from||!to||to.iso<from.iso))return Alert.alert('راجع الطلب','أدخل تاريخين صحيحين؛ نهاية الإجازة لا تسبق بدايتها. مثال: 1/11/2026 أو ٠١١١٢٠٢٦');
   pending.current={id:newId(),kind,reason,...(kind==='advance'?{amount,currency}:{startDate:from!.iso,endDate:to!.iso,leaveType})};
  }
  setBusy(true);
  try{await (await getClient()).post('/hr/requests',pending.current);pending.current=null;setReason('');setAmount('');await q.refetch();Alert.alert('تم الإرسال','ظهر الطلب لدى المسؤول للمراجعة.');}
  catch(e:any){if(e.response&&e.response.status>=400&&e.response.status<500)pending.current=null;Alert.alert('تعذر تأكيد الإرسال',e.response?.data?.message?.toString()||'تحقق من الاتصال ثم أعد الإرسال من هذه الشاشة؛ ستُعاد المحاولة بنفس الطلب لمنع التكرار.');}
  finally{setBusy(false);}
 };
 const button=(title:string,action:()=>void,selected=false)=><TouchableOpacity key={title} accessibilityRole="button" disabled={busy} style={[s.button,selected&&s.selected]} onPress={action}><Text style={s.buttonText}>{title}</Text></TouchableOpacity>;
 const input=(label:string,value:string,change:(v:string)=>void,numeric=false)=><View><Text style={s.text}>{label}</Text><TextInput ref={node=>{inputRefs.current[label]=node;}} accessibilityLabel={label} editable={!busy&&!pending.current} style={s.input} value={value} onChangeText={change} onFocus={()=>{focused.current=inputRefs.current[label];requestAnimationFrame(revealInput);}} onBlur={()=>{focused.current=null;}} returnKeyType="done" onSubmitEditing={()=>Keyboard.dismiss()} keyboardType={numeric?'decimal-pad':'default'} maxLength={label==='سبب الطلب'?1500:40}/></View>;
 return <KeyboardAvoidingView style={s.page} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={headerHeight}><ScrollView ref={scroll} onScroll={e=>{scrollY.current=e.nativeEvent.contentOffset.y;}} scrollEventThrottle={16} style={s.page} contentContainerStyle={{padding:16,paddingBottom:32,gap:14}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onLayout={()=>{if(keyboardVisible)requestAnimationFrame(revealInput);}}>
  <Text style={s.title}>طلبات السلف والإجازات</Text><Text style={s.text}>الإرسال والتحديث يحتاجان اتصالًا. موافقة السلفة لا تعني صرفها أو خصم أقساطها تلقائيًا.</Text>
  {button('تحديث الطلبات',()=>{void q.refetch();})}
  {q.isLoading&&<Text style={s.text}>جارٍ التحميل…</Text>}
  {q.isError&&<Text style={s.text}>تعذر تحديث الطلبات. تحقق من الاتصال؛ لا تعتمد على حالة قديمة.</Text>}
  {q.data&&!q.data.employee&&<Text style={s.text}>اطلب من الإدارة ربط حساب الدخول بملف الموظف النشط لتتمكن من تقديم الطلبات.</Text>}
  {q.data?.employee&&<><View style={s.card}><Text style={s.title}>{q.data.employee.fullName}</Text>
   {!pending.current&&<View style={s.row}>{button('سلفة',()=>setKind('advance'),kind==='advance')}{button('إجازة',()=>setKind('leave'),kind==='leave')}</View>}
   {kind==='advance'?<>{input('مبلغ السلفة',amount,setAmount,true)}{!pending.current&&<View style={s.row}>{['YER','SAR','USD'].map(c=>button(c,()=>setCurrency(c),currency===c))}</View>}</>:<>{!pending.current&&<View style={s.row}>{Object.entries(leaves).map(([v,t])=>button(t,()=>setLeave(v),leaveType===v))}</View>}{input('من تاريخ — مثال 1/11 أو ٠١١١٢٠٢٦',startDate,setStart)}{input('إلى تاريخ — يوم/شهر/سنة',endDate,setEnd)}</>}
   {kind==='leave'&&<Text style={s.text}>من: {parseFlexibleDate(startDate)?.display||'أدخل تاريخ البداية'} — إلى: {parseFlexibleDate(endDate)?.display||'أدخل تاريخ النهاية'}</Text>}{input('سبب الطلب',reason,setReason)}{button(busy?'جارٍ الإرسال…':pending.current?'إعادة إرسال الطلب نفسه':'إرسال الطلب',()=>void send())}
  </View><Text style={s.title}>طلباتي</Text>{q.data.requests.length===0&&<Text style={s.text}>لا توجد طلبات بعد.</Text>}
  {q.data.requests.map((r:any)=><View key={r.id} style={[s.card,route?.params?.requestId===r.id&&{borderWidth:2,borderColor:colors.gold}]}><Text style={s.title}>{r.kind==='advance'?'سلفة':'إجازة'} — {labels[r.status]}</Text><Text style={s.text}>{r.kind==='advance'?`${r.amount} ${r.currency}`:`${leaves[r.leaveType]}: ${r.startDate.slice(0,10)} إلى ${r.endDate.slice(0,10)}`}</Text><Text style={s.text}>{r.reason}</Text>{r.decisionReason&&<Text style={s.text}>سبب القرار: {r.decisionReason}</Text>}{r.kind==='advance'&&r.status==='approved'&&<Text style={s.text}>الموافقة فقط؛ لم يُسجل صرف السلفة.</Text>}</View>)}</>}
 </ScrollView>{keyboardVisible&&<TouchableOpacity accessibilityRole="button" onPress={()=>Keyboard.dismiss()} style={[s.button,{margin:8}]}><Text style={s.buttonText}>إخفاء لوحة المفاتيح</Text></TouchableOpacity>}</KeyboardAvoidingView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:colors.background},card:{backgroundColor:'#fff',padding:16,borderRadius:12,gap:10},title:{fontFamily:'TajawalBold',fontSize:18,textAlign:'right',color:colors.primary},text:{fontFamily:'TajawalRegular',fontSize:15,textAlign:'right',color:'#253b35'},input:{borderWidth:1,borderColor:'#b7c4bd',borderRadius:8,padding:10,textAlign:'right',fontFamily:'TajawalRegular',color:'#172a24'},row:{flexDirection:'row',flexWrap:'wrap',gap:8},button:{padding:12,borderRadius:8,backgroundColor:colors.primary,opacity:.8},selected:{opacity:1,borderWidth:2,borderColor:colors.gold},buttonText:{color:'#fff',fontFamily:'TajawalBold',textAlign:'center'}});
