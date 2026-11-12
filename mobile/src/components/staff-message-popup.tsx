import React from 'react';
import {AppState,Modal,ScrollView,Text,TouchableOpacity,View} from 'react-native';
import {useAuth} from '../store/auth-context';
import {getClient} from '../api/client';
import {isOperationsApp} from '../config/product';
import {colors} from '../theme';
export default function StaffMessagePopup(){
 const {isAuthenticated,user}=useAuth();
 const [notice,setNotice]=React.useState<any>(null),[busy,setBusy]=React.useState(false);
 React.useEffect(()=>{
  setNotice(null);if(!isAuthenticated||!user?.id)return;
  let live=true,checking=false;
  const load=async()=>{if(checking||AppState.currentState!=='active')return;checking=true;try{const {data}=await(await getClient()).get(`/notifications?unreadOnly=true&kind=staff_broadcast&limit=1&application=${isOperationsApp?'operations':'collector'}`);if(live)setNotice(data.items?.[0]??null);}catch{/* Try again when the connection returns. */}finally{checking=false;}};
  void load();const timer=setInterval(()=>void load(),20000);const listener=AppState.addEventListener('change',next=>{if(next==='active')void load();});
  return()=>{live=false;clearInterval(timer);listener.remove();};
 },[isAuthenticated,user?.id]);
 const read=async()=>{if(busy||!notice)return;setBusy(true);try{await(await getClient()).patch(`/notifications/${notice.id}/read`);setNotice(null);}catch{/* Keep the message visible until its acknowledgement is saved. */}finally{setBusy(false);}};
 return <Modal visible={isAuthenticated&&!!notice} transparent animationType="fade" onRequestClose={()=>void read()}>
  <View style={{flex:1,justifyContent:'center',backgroundColor:'#0009',padding:24}}>
   <View style={{maxHeight:'85%',backgroundColor:'#fff',borderRadius:20,padding:24,gap:18}}>
    <ScrollView><Text style={{fontFamily:'TajawalBold',fontSize:22,textAlign:'right',marginBottom:18}}>{notice?.payload?.title||'رسالة من الإدارة'}</Text><Text style={{fontFamily:'TajawalRegular',fontSize:18,textAlign:'right'}}>{notice?.payload?.message}</Text></ScrollView>
    <TouchableOpacity onPress={()=>void read()} disabled={busy} style={{padding:14,borderRadius:12,backgroundColor:colors.primary}}><Text style={{color:'#fff',textAlign:'center',fontFamily:'TajawalBold'}}>{busy?'جارٍ الحفظ...':'تم الاطلاع'}</Text></TouchableOpacity>
   </View>
  </View>
 </Modal>;
}
