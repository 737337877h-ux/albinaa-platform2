import React from 'react';
import {View,Text,Button,ActivityIndicator} from 'react-native';
import {WebView} from 'react-native-webview';
import {useAuth} from '../store/auth-context';
import {getClient} from '../api/client';
import {getBaseUrl,prepareOnlineRoute} from '../config/api';
import {getAccessToken} from '../utils/secure-storage';
import {platformOrigin,platformTools} from '../utils/platform-tools';
export default function PlatformTool({route}:any){
 const {user}=useAuth();const tool=platformTools.find(t=>t.route===route.name);
 const [source,setSource]=React.useState<{uri:string;method:'POST';body:string;headers:Record<string,string>}|null>(null),[error,setError]=React.useState('');
 const allowed=!!tool&&!!user?.permissions.includes(tool.permission);
 const load=React.useCallback(async()=>{setSource(null);setError('');try{
  if(!allowed||!tool)throw Error('لا تملك صلاحية هذه الشاشة');
  const health=await prepareOnlineRoute();if(!health.ok)throw Error('هذه الشاشة تحتاج اتصالًا بالمنصة');
  const me=(await (await getClient()).get('/auth/me')).data;
  if(me.id!==user?.id||me.organizationId!==user?.organizationId||!me.permissions.includes(tool.permission))throw Error('تغيرت صلاحية حسابك؛ حدّث تسجيل الدخول');
  const token=await getAccessToken();if(!token)throw Error('أعد تسجيل الدخول');
  setSource({uri:platformOrigin(await getBaseUrl())+'/mobile-entry',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'path='+encodeURIComponent(tool.path)+'&token='+encodeURIComponent(token)});
 }catch(e:any){setError(e.message||'تعذر فتح الشاشة');}},[allowed,tool,user?.id,user?.organizationId]);
 React.useEffect(()=>{void load();},[load]);
 if(!allowed)return <Text>لا تملك صلاحية هذه الشاشة</Text>;
 if(error)return <View style={{padding:24,gap:16}}><Text>{error}</Text><Button title="إعادة الاتصال" onPress={()=>void load()}/></View>;
 if(!source)return <ActivityIndicator style={{margin:30}}/>;
 const origin=new URL(source.uri).origin;
 return <WebView key={source.body} source={source} incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false} allowFileAccess={false} allowFileAccessFromFileURLs={false} mixedContentMode="never" originWhitelist={[origin]} startInLoadingState renderLoading={()=><ActivityIndicator/>}
  onShouldStartLoadWithRequest={r=>{try{return new URL(r.url).origin===origin;}catch{return false;}}}
  onNavigationStateChange={r=>{if(new URL(r.url).pathname==='/login')setError('انتهت جلسة الشاشة؛ اضغط إعادة الاتصال لتجديدها');}}
  onError={()=>setError('تعذر الوصول إلى المنصة؛ أعد الاتصال')}/>;
}
