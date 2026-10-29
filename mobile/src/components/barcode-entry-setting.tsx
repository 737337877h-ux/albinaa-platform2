import React from 'react';
import {Keyboard, Switch, Text, View} from 'react-native';
import {getMeta,setMeta} from '../db/database';
import {colors} from '../theme';
export function useBarcodeEntrySetting(){
 const [automatic,setAutomatic]=React.useState(true);
 const [keyboardVisible,setKeyboardVisible]=React.useState(false);
 const changed=React.useRef(false);
 React.useEffect(()=>{let alive=true;void getMeta('barcode:auto-next').then(value=>{if(alive&&!changed.current&&value!==null)setAutomatic(value==='true');}).catch(()=>undefined);const show=Keyboard.addListener('keyboardDidShow',()=>setKeyboardVisible(true));const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardVisible(false));return()=>{alive=false;show.remove();hide.remove();};},[]);
 return {automatic,keyboardVisible,setAutomatic:(value:boolean)=>{changed.current=true;setAutomatic(value);void setMeta('barcode:auto-next',String(value)).catch(()=>undefined);}};
}
export default function BarcodeEntrySetting({value,onChange}:{value:boolean;onChange:(value:boolean)=>void}){return <View style={{flexDirection:'row-reverse',alignItems:'center',gap:8,marginBottom:12}}><Switch value={value} onValueChange={onChange}/><Text style={{flex:1,textAlign:'right',color:colors.ink,fontFamily:'TajawalBold'}}>فتح القارئ تلقائيًا بعد تأكيد السطر</Text></View>;}
