import React from 'react';
import {Linking,StyleSheet,Switch,Text,TouchableOpacity,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useAuth} from '../store/auth-context';
import {businessBackgroundSyncStatus,setBusinessBackgroundSyncEnabled} from '../utils/background-sync';
import {colors,radius} from '../theme';

const labels={synced:'اكتملت المحاولة',offline:'الخادم غير متاح؛ العمليات محفوظة',locked:'توقفت عند قفل الجلسة؛ يلزم الدخول',account_changed:'توقف الإرسال عند تبديل الحساب',failed:'تعذرت المحاولة؛ ستعاد لاحقًا'};
export default function BackgroundSyncStatus(){
 const {user}=useAuth(),[state,setState]=React.useState<Awaited<ReturnType<typeof businessBackgroundSyncStatus>>|null>(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const load=React.useCallback(async()=>{try{setState(await businessBackgroundSyncStatus());setError('');}catch{setError('تعذر قراءة حالة المزامنة في الخلفية');}},[]);
 useFocusEffect(React.useCallback(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load,user?.id]));
 return <View style={s.card}>
  <View style={s.row}><Text style={s.title}>المزامنة في الخلفية</Text><Switch accessibilityLabel="تفعيل المزامنة في الخلفية" value={state?.enabled??true} disabled={busy||!state} onValueChange={enabled=>{setBusy(true);void setBusinessBackgroundSyncEnabled(enabled).catch(()=>setError('تعذر تغيير إعداد الخلفية')).finally(()=>{setBusy(false);void load();});}}/></View>
  <Text style={s.text}>{!state?'جارٍ الفحص...':!state.enabled?'متوقفة باختيارك':!state.available?'الهاتف يقيّد تشغيل المهام الخلفية':state.registered?'مسجّلة لدى الهاتف':'غير مسجّلة؛ أعد تفعيلها بعد الدخول'}</Text>
  <Text style={s.text}>آخر محاولة: {state?.lastRun?new Date(state.lastRun.attemptedAt).toLocaleString('ar-YE'):'لم تسجل محاولة بعد'}</Text>
  {!!state?.lastRun&&<Text style={s.text}>{labels[state.lastRun.outcome]}{state.lastRun.uploaded!=null?` • أُرسلت ${state.lastRun.uploaded} عملية`:''}</Text>}
  <Text style={s.text}>آخر نجاح: {state?.lastSuccessAt?new Date(state.lastSuccessAt).toLocaleString('ar-YE'):'لم يسجل بعد'}</Text>
  <Text style={s.hint}>يحاول التطبيق الإرسال عند الانتقال للخلفية. المواعيد اللاحقة يحددها الهاتف حسب الشبكة والبطارية؛ وقد يؤخرها أو يوقفها عند الإيقاف الإجباري. تتوقف المزامنة عند قفل الجلسة بعد 15 دقيقة، وتبقى العمليات محفوظة حتى دخولك.</Text>
  {!!error&&<Text style={s.text}>{error}</Text>}
  <TouchableOpacity accessibilityRole="button" onPress={()=>void load()}><Text style={s.link}>تحديث الحالة</Text></TouchableOpacity>
  <TouchableOpacity accessibilityRole="button" onPress={()=>void Linking.openSettings()}><Text style={s.link}>إعدادات التطبيق في الهاتف</Text></TouchableOpacity>
 </View>;
}
const s=StyleSheet.create({card:{backgroundColor:colors.surface,padding:18,borderRadius:radius.md,gap:12},row:{flexDirection:'row-reverse',justifyContent:'space-between',alignItems:'center'},title:{fontFamily:'TajawalBold',fontSize:18,color:colors.primary,textAlign:'right'},text:{fontFamily:'TajawalRegular',textAlign:'right',color:colors.primary},hint:{fontFamily:'TajawalRegular',textAlign:'right',lineHeight:23,color:colors.muted,fontSize:13},link:{fontFamily:'TajawalBold',textAlign:'right',paddingVertical:8,color:colors.primary}});
