import React from 'react';
import {ActivityIndicator,Alert,Modal,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {CameraView,useCameraPermissions} from 'expo-camera';
import * as Location from 'expo-location';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {getMeta,setMeta,attendanceRows,saveAttendanceLocal,attendanceResult} from '../db/database';
import {attendanceCacheKey,projectAttendance,syncAttendance} from '../utils/attendance-offline';
import {useFocusEffect} from '@react-navigation/native';
import {getClient} from '../api/client';
import {useAuth} from '../store/auth-context';
import {colors} from '../theme';
const newId=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16);});
const time=(s:string)=>new Date(s).toLocaleString('ar-YE',{timeZone:'Asia/Aden'});
export default function HrAttendanceScreen(){
 const {user}=useAuth(),[permission,requestPermission]=useCameraPermissions();
 const [scan,setScan]=React.useState<'in'|'break_out'|'break_in'|'out'|null>(null),[busy,setBusy]=React.useState(false);
 const lock=React.useRef(false); const cache=useQueryClient(); const scope=user?`${user.organizationId}:${user.id}`:'';
 const local=async()=>{const raw=await getMeta(attendanceCacheKey(scope));const rows=await attendanceRows(scope);const data=projectAttendance(raw?JSON.parse(raw):null,rows);return data?{...data,localRows:rows}:null;};
 const q=useQuery({queryKey:['hr-attendance',scope],enabled:!!scope,queryFn:async()=>{
  try{const r=(await (await getClient()).get('/hr/attendance/mine',{timeout:5000})).data;if(await getMeta('dataOwner')===scope)await setMeta(attendanceCacheKey(scope),JSON.stringify(r));}
  catch{/* Use the last employee schedule and attendance saved on this phone. */}
  return local();
 },retry:false,refetchInterval:15000});
 useFocusEffect(React.useCallback(()=>{void q.refetch();},[q.refetch]));
 const send=async(action:'in'|'break_out'|'break_in'|'out',method:'qr'|'location',token?:string)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setScan(null);
  try{
   {
    let evidence:any={};
    if(method==='qr'){if(!token?.startsWith('ALBINAA-HR.'))throw new Error('امسح رمز حضور المنشأة من المنصة');evidence={token};}
    else{
     const granted=await Location.requestForegroundPermissionsAsync();if(granted.status!=='granted')throw new Error('اسمح بالوصول إلى الموقع لتسجيل الحضور الميداني');
     let timer:ReturnType<typeof setTimeout>|undefined;
     const point=await Promise.race([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('تعذر تحديد الموقع خلال 30 ثانية؛ تحقق من GPS وأعد المحاولة')),30000);})]).finally(()=>{if(timer)clearTimeout(timer);});
     if(point.coords.accuracy==null)throw new Error('تعذرت قراءة دقة الموقع');
     evidence={latitude:point.coords.latitude,longitude:point.coords.longitude,accuracy:point.coords.accuracy,capturedAt:point.timestamp,mocked:point.mocked??false};
    }
    const payload={operationId:newId(),employeeId:q.data?.employee?.id,recordedAt:Date.now(),action,method,...evidence};
    if(!payload.employeeId)throw Error('افتح سجل الحضور مرة واحدة أثناء الاتصال لتحميل ملفك');
    await saveAttendanceLocal(scope,payload);
   }
   cache.setQueryData(['hr-attendance',scope],await local());
   Alert.alert('حُفظت الحركة على الهاتف','ستُرسل تلقائيًا عند توفر الاتصال. تابع حالة المزامنة أدناه.');
   void syncAttendance().then(()=>q.refetch()).catch(()=>undefined);
  }catch(e:any){Alert.alert('لم تُحفظ الحركة',e.response?.data?.message?.toString()||e.message||'أعد المحاولة');}
  finally{lock.current=false;setBusy(false);}
 };
 const openScan=async(action:'in'|'break_out'|'break_in'|'out')=>{if(!permission?.granted){const result=await requestPermission();if(!result.granted){Alert.alert('الكاميرا','صلاحية الكاميرا مطلوبة لمسح رمز الحضور');return;}}setScan(action);};
 const button=(title:string,fn:()=>void)=><TouchableOpacity key={title} accessibilityRole="button" disabled={busy} style={s.button} onPress={fn}><Text style={s.btnText}>{title}</Text></TouchableOpacity>;
 const e=q.data?.employee,open=q.data?.open;const next=(!open?'in':!open.schedule?.fourPunches?'out':!open.breakOut?'break_out':!open.breakIn?'break_in':'out') as 'in'|'break_out'|'break_in'|'out';const actionLabel={in:'الحضور',break_out:'الخروج للاستراحة',break_in:'العودة من الاستراحة',out:'الانصراف النهائي'};
 return <SafeAreaView edges={['bottom']} style={{flex:1,backgroundColor:colors.background}}><ScrollView contentContainerStyle={s.content}>
  <Text style={s.title}>الحضور والانصراف</Text><Text style={s.text}>تُحفظ الحركة على الهاتف فورًا وتُزامن تلقائيًا عند توفر الاتصال بوقت تسجيلها الأصلي. يُحفظ الموقع عند التسجيل فقط.</Text>
  {button('تحديث السجل والمزامنة',()=>{void syncAttendance().then(()=>q.refetch()).catch(()=>q.refetch());})}{busy&&<ActivityIndicator/>}
  {q.data?.localRows?.some((r:any)=>r.status==='rejected')&&button('إعادة محاولة المزامنة بعد مراجعة السبب',()=>{void (async()=>{for(const r of q.data.localRows)if(r.status==='rejected')await attendanceResult(r.operationId,'pending');await syncAttendance();await q.refetch();})();})}
  {q.isLoading&&<Text style={s.text}>جارٍ التحميل…</Text>}{q.isError&&<Text style={s.text}>تعذر تحديث السجل؛ تحقق من الاتصال قبل التسجيل.</Text>}
  {!q.data&&<Text style={s.text}>يلزم فتح هذه الشاشة مرة أثناء الاتصال لتحميل بيانات الموظف.</Text>}{q.data?.localRows?.filter((r:any)=>r.status!=='synced').map((r:any)=><View key={r.operationId} style={s.card}><Text style={s.text}>{time(JSON.parse(r.payload).recordedAt)} — {r.status==='rejected'?'تحتاج مراجعة المسؤول':'محفوظة محليًا — بانتظار المزامنة'}</Text>{r.error&&<Text style={s.text}>{r.error}</Text>}</View>)}
  {q.data&&!e&&<Text style={s.text}>اطلب من المسؤول ربط حسابك بملف موظف نشط.</Text>}
  {e&&<View style={s.card}><Text style={s.title}>{e.fullName}</Text>{e.attendanceExempt?<Text style={s.text}>أنت معفى من تسجيل الحضور والانصراف.</Text>:<><Text style={s.text}>الدوام: {e.startTime??'غير محدد'} إلى {e.endTime??'غير محدد'} — الراحة {e.breakMinutes} دقيقة</Text><Text style={s.text}>{q.data.open?`حضور مفتوح منذ ${time(q.data.open.checkIn)}`:'لا يوجد حضور مفتوح'}</Text>{!q.data?.localRows?.some((r:any)=>r.status==='rejected')&&<>{button(`تسجيل ${actionLabel[next]} بمسح الرمز`,()=>void openScan(next))}{e.workMode!=='office'&&<><Text style={s.text}>للميدان: يُقبل أي موقع مع حفظ الإحداثيات ودقتها للمراجعة.</Text>{button(`تسجيل ${actionLabel[next]} بالموقع`,()=>void send(next,'location'))}</>}</>}</>}</View>}
  {open&&next!=='out'&&!q.data?.localRows?.some((r:any)=>r.status==='rejected')&&button('انصراف نهائي قبل إكمال الفترتين',()=>e?.workMode==='office'?void openScan('out'):void send('out','location'))}<Text style={s.title}>آخر سجلاتي</Text>{q.data?.records.map((r:any)=><View key={r.id} style={s.card}><Text style={s.title}>{r.workDate.slice(0,10)}</Text><Text style={s.text}>الحضور: {time(r.checkIn)}</Text><Text style={s.text}>الانصراف: {r.checkOut?time(r.checkOut):'لم يسجل'}</Text><Text style={s.text}>{!r.schedule?.fourPunches?'سجل سابق بنظام دخول وانصراف':'حركات الاستراحة'}</Text>{r.schedule?.fourPunches&&<Text style={s.text}>الخروج للاستراحة: {r.breakOut?time(r.breakOut):'لم يسجل'} — العودة: {r.breakIn?time(r.breakIn):'لم تسجل'}</Text>}<Text style={s.text}>طريقة الحضور: {r.inEvidence.method==='qr'?'رمز المنشأة':'الموقع'}</Text>{r.inEvidence.needsLocationReview&&<Text style={s.text}>دقة الموقع تحتاج مراجعة المسؤول.</Text>}</View>)}
 </ScrollView><Modal visible={scan!==null} onRequestClose={()=>setScan(null)}><SafeAreaView style={{flex:1,backgroundColor:'#102b23',padding:16,gap:12}}><Text style={[s.title,{color:'#fff'}]}>امسح رمز الحضور المتغير من شاشة المنصة</Text>{scan&&<CameraView style={{flex:1}} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>{if(scan)void send(scan,'qr',data);}}/>}{button('إغلاق الكاميرا',()=>setScan(null))}</SafeAreaView></Modal></SafeAreaView>;
}
const s=StyleSheet.create({content:{padding:16,gap:14},card:{padding:16,gap:10,backgroundColor:'#fff',borderRadius:12},title:{fontFamily:'TajawalBold',fontSize:18,textAlign:'right',color:colors.primary},text:{fontFamily:'TajawalRegular',fontSize:15,textAlign:'right',color:'#253b35'},button:{padding:14,borderRadius:8,backgroundColor:colors.primary},btnText:{fontFamily:'TajawalBold',textAlign:'center',color:'#fff'}});
