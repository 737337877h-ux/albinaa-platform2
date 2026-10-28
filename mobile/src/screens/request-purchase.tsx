import BarcodeEntrySetting, {useBarcodeEntrySetting} from '../components/barcode-entry-setting';
import {incrementBarcodeLine, barcodeItem} from '../utils/barcode-lines';
import { requestActionStyles } from '../components/request-action-styles';
import React from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchTransferItem, fetchTransferWarehouses, searchTransferItems } from '../api/endpoints';
import RequestSearchPicker, { RequestPickerOption } from '../components/request-search-picker';
import RequestBarcodeScanner from '../components/request-barcode-scanner';
import RequestItemCard, { RequestItemLine } from '../components/request-item-card';
import RequestUnitPickerModal from '../components/request-unit-picker-modal';
import { apiErrorMessage } from '../utils/errors';
import { colors, radius } from '../theme';
import { saveOfflineDraft, submitOfflineDraft } from '../utils/offline-request';
import { revealInput } from '../utils/keyboard';
import { useSync } from '../store/sync-context';

const newLine=():RequestItemLine=>({id:`${Date.now()}-${Math.random()}`,quantity:'1',units:[],expanded:true});
const newReference=()=>`mobile-purchase:${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

export default function RequestPurchaseScreen({navigation,route}:any){
  const {automatic,keyboardVisible,setAutomatic}=useBarcodeEntrySetting();
  const draft=route.params?.draftPayload as any|undefined;
  const draftId=String(route.params?.draftOperationId||draft?.externalReference||newReference());
  const restoredLines=React.useMemo(()=>Array.isArray(draft?.lines)&&draft.lines.length?draft.lines.map((row:any,index:number)=>{const item={key:String(row.itemCode||''),label:String(row.itemName||row.itemCode||'صنف'),hint:String(row.itemCode||'')};const unit={key:String(row.unitCode||''),label:String(row.unitName||row.unitCode||'الوحدة')};return{id:`draft-${index}-${row.itemCode}`,item,unit,units:[unit],quantity:String(row.quantity??1),expanded:true} as RequestItemLine;}):[newLine()],[]);
  const insets=useSafeAreaInsets();
  const footerBottom=Math.max(insets.bottom,12);
  const [warehouse,setWarehouse]=React.useState<RequestPickerOption|undefined>(draft?.warehouseCode?{key:String(draft.warehouseCode),label:String(draft.warehouseName||draft.warehouseCode)}:undefined);
  const [notes,setNotes]=React.useState(String(draft?.notes||'طلب شراء من تطبيق البناء الراقي'));
  const [lines,setLines]=React.useState<RequestItemLine[]>(restoredLines);
  const [externalReference]=React.useState(()=>String(draft?.externalReference||draftId));
  const [itemSearch,setItemSearch]=React.useState('');
  const [scanLineId,setScanLineId]=React.useState<string>();
  const [unitLineId,setUnitLineId]=React.useState<string>();
  const quantityRefs=React.useRef<Record<string,TextInput|null>>({});
  const scrollRef=React.useRef<ScrollView|null>(null);
  const deferredSearch=React.useDeferredValue(itemSearch);
  const {triggerSync}=useSync();
  const warehouses=useQuery({queryKey:['request-warehouses'],queryFn:async()=> (await fetchTransferWarehouses()).data});
  const items=useQuery({queryKey:['request-items',deferredSearch],queryFn:async()=> (await searchTransferItems(deferredSearch)).data});
  const warehouseOptions=((warehouses.data?.items??warehouses.data??[]) as any[]).map((row)=>({key:String(row.externalWarehouseCode??row.code),label:row.nameAr??row.name??row.code,hint:String(row.externalWarehouseCode??row.code),raw:row}));
  const itemOptions=((items.data?.items??items.data??[]) as any[]).map((row)=>{const code=String(row.externalItemCode??row.itemCode);const size=row.sizeName??row.size??row.itemSize;return{key:code,label:row.nameAr??row.itemName??code,hint:size?`${code} · المقاس ${size}`:code,raw:row};});
  const invalidate=()=>undefined;
  const patchLine=(id:string,change:Partial<RequestItemLine>)=>{setLines((rows)=>rows.map((line)=>line.id===id?{...line,...change}:line));invalidate();};
  const focusQuantity=(id:string)=>setTimeout(()=>revealInput(scrollRef.current,quantityRefs.current[id],170),180);
  const selectItem=async(id:string,option:RequestPickerOption)=>{try{const detail=(await fetchTransferItem(option.key)).data;const units=((detail.units??[]) as any[]).filter((row)=>row.isInactive!==true).map((row)=>({key:String(row.unitName??row.unitCode),label:String(row.unitName??row.unitCode),hint:row.packageSize?`حجم العبوة ${row.packageSize}`:undefined,raw:row}));if(!units.length)return Alert.alert('لا توجد وحدة مفعلة','لا توجد وحدة صالحة لهذا الصنف في البيانات المحلية.');patchLine(id,{item:{...option,raw:{...(option.raw as any),...detail}},units,unit:units.length===1?units[0]:undefined,expanded:true});if(units.length>1)setUnitLineId(id);else focusQuantity(id);}catch(error){Alert.alert('تعذر تحميل الصنف',apiErrorMessage(error,'تحقق من الاتصال ثم أعد المحاولة.'));}};
  const incrementExisting=(code:string)=>{const matches=lines.filter(line=>line.item?.key===code);if(!matches.length)return false;if(matches.length>1){Alert.alert('اختر السطر','الصنف موجود بأكثر من وحدة أو سعر؛ عدّل كمية السطر المطلوب.');return true;}const target=matches[0];setLines(rows=>incrementBarcodeLine(rows,target.id));invalidate();focusQuantity(target.id);return true;};
  const acceptBarcode=async(value:string)=>{const id=scanLineId;setScanLineId(undefined);if(!id)return;try{const response=(await searchTransferItems(value)).data;const rows=((response?.items??response??[]) as any[]);const exact=barcodeItem(rows,value);if(!exact)return Alert.alert('باركود غير معروف','لم يُعثر على صنف مطابق في IAS20261.');if(incrementExisting(String(exact.externalItemCode??exact.itemCode)))return;patchLine(id,{quantity:'1'});await selectItem(id,{key:String(exact.externalItemCode??exact.itemCode),label:exact.nameAr??exact.itemName??value,hint:String(exact.externalItemCode??exact.itemCode),raw:exact});}catch(error){Alert.alert('تعذر قراءة الصنف',apiErrorMessage(error,'تحقق من الاتصال.'));}};
  const payload=React.useMemo(()=>({externalReference,warehouseCode:warehouse?.key??'',requestSide:'منصة البناء الراقي',notes,lines:lines.map((line)=>({itemCode:line.item?.key??'',unitCode:line.unit?.key??'',quantity:Number(line.quantity)}))}),[externalReference,warehouse,notes,lines]);
  const finishLine=(id:string)=>{const current=lines.find((line)=>line.id===id);if(!current?.item||!current.unit||!(Number(current.quantity)>0))return Alert.alert('أكمل السطر','اختر الوحدة وأدخل كمية الطلب قبل الانتقال للصنف التالي.');const existing=lines.find((line)=>line.id!==id&&!line.item);const next=existing??newLine();setLines((rows)=>{const updated=rows.map((line)=>line.id===id?{...line,expanded:false}:line);return existing?updated:[...updated,next];});invalidate();Keyboard.dismiss();if(automatic)setTimeout(()=>setScanLineId(next.id),220);};
  const validate=()=>{if(!warehouse||!notes.trim()||lines.some((line)=>!line.item||!line.unit||!(Number(line.quantity)>0))){Alert.alert('بيانات ناقصة','اختر المستودع وأكمل الصنف والوحدة والكمية لكل بطاقة.');return false;}return true;};
  const saveOffline=async()=>{if(!validate())return;await saveOfflineDraft({kind:'purchase',title:'طلب شراء',endpoint:'/oracle-test-requests/purchases',operationId:draftId,payload});Alert.alert('حُفظت المسودة','بقيت في قاعدة الهاتف فقط ويمكن تعديلها من عمليات ONYX.',[{text:'حسنًا',onPress:()=>navigation.goBack()}]);};
  const inspectAndSend=async()=>{if(!validate())return;await submitOfflineDraft({kind:'purchase',title:'طلب شراء',endpoint:'/oracle-test-requests/purchases',operationId:draftId,payload});void triggerSync().catch(()=>undefined);Alert.alert('بدأ الفحص والإرسال','سيفحص التطبيق الطلب أولًا، ولن يحفظه في IAS20261 إذا لم يجتز الفحص.',[{text:'حسنًا',onPress:()=>navigation.goBack()}]);};
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={70}>
    <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
<BarcodeEntrySetting value={automatic} onChange={setAutomatic}/>
      {warehouses.isError?<View style={styles.error}><Text style={styles.errorText}>تعذر تحميل مستودعات IAS20261.</Text><TouchableOpacity onPress={()=>warehouses.refetch()}><Text style={styles.retry}>إعادة المحاولة</Text></TouchableOpacity></View>:null}
      <RequestSearchPicker label="المستودع" value={warehouse} options={warehouseOptions} onSelect={(value)=>{setWarehouse(value);invalidate();}} loading={warehouses.isLoading}/>
      <Field label="البيان" value={notes} onChangeText={(value)=>{setNotes(value);invalidate();}}/>
      <Text style={[styles.label,{fontSize:18,marginBottom:7}]}>الأصناف</Text>
      {lines.map((line,index)=><RequestItemCard key={line.id} index={index} line={line} itemOptions={itemOptions} itemsLoading={items.isLoading} quantityLabel="كمية الطلب" removable={lines.length>1} onSearch={setItemSearch} onScan={()=>setScanLineId(line.id)} onItem={(option)=>selectItem(line.id,option)} onOpenUnit={()=>line.units.length>1?setUnitLineId(line.id):focusQuantity(line.id)} onQuantity={(quantity)=>patchLine(line.id,{quantity})} onQuantityFocus={()=>revealInput(scrollRef.current,quantityRefs.current[line.id],170)} onQuantitySubmit={()=>finishLine(line.id)} onQuantityRef={(input)=>{quantityRefs.current[line.id]=input;}} onEdit={()=>patchLine(line.id,{expanded:true})} onClear={()=>patchLine(line.id,{item:undefined,unit:undefined,units:[],quantity:'1',expanded:true})} onRemove={()=>{setLines((rows)=>rows.filter((row)=>row.id!==line.id));invalidate();}}/>)}
      <View style={[styles.bottomSpacer,{height:80+footerBottom}]}/>
    </ScrollView>
    <View style={[styles.footer, keyboardVisible&&{display:'none'},{paddingBottom:footerBottom}]}>
      <TouchableOpacity style={styles.add} onPress={()=>{setLines((rows)=>rows.some((line)=>!line.item)?rows:[...rows,newLine()]);invalidate();}}><Ionicons name="add-circle-outline" size={20} color={colors.primary}/><Text style={styles.addText}>إضافة صنف</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={saveOffline}><Text style={styles.secondaryText}>حفظ مسودة</Text></TouchableOpacity>
      <TouchableOpacity style={styles.primary} onPress={inspectAndSend}><Text style={styles.primaryText}>فحص وإرسال الطلب</Text></TouchableOpacity>
    </View>
    <RequestBarcodeScanner visible={Boolean(scanLineId)} onClose={()=>setScanLineId(undefined)} onScanned={acceptBarcode}/>
    <RequestUnitPickerModal visible={Boolean(unitLineId)} itemName={lines.find((line)=>line.id===unitLineId)?.item?.label} options={lines.find((line)=>line.id===unitLineId)?.units??[]} value={lines.find((line)=>line.id===unitLineId)?.unit} onClose={()=>setUnitLineId(undefined)} onSelect={(unit)=>{const id=unitLineId;if(!id)return;patchLine(id,{unit});setUnitLineId(undefined);focusQuantity(id);}}/>
  </KeyboardAvoidingView>;
}

function Field({label,value,onChangeText}:{label:string;value:string;onChangeText:(value:string)=>void}){return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} textAlign="right" placeholderTextColor={colors.muted}/></View>;}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.background},scroll:{flex:1},content:{padding:12},field:{marginBottom:9},label:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900',textAlign:'right',marginBottom:5},input:{minHeight:48,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:12,color:colors.ink},error:{backgroundColor:'#FDECEC',borderRadius:radius.sm,padding:10,marginBottom:9},errorText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.danger,textAlign:'right',fontWeight:'800'},retry:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,textAlign:'center',fontWeight:'900',marginTop:6},scanSetting:{flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:8,marginBottom:9},scanSettingText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'800'},bottomSpacer:{height:92},footer:{position:'absolute',bottom:0,left:0,right:0,flexDirection:'row-reverse',gap:6,padding:9,paddingBottom:12,backgroundColor:colors.surface,borderTopWidth:1,borderTopColor:colors.line},add:{flex:1,minHeight:48,flexDirection:'row-reverse',gap:5,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.primary,borderRadius:radius.sm},addText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},primary:{ ...requestActionStyles.primary, flex:1.15 },primaryText:{ ...requestActionStyles.primaryText, fontWeight:'900' },secondary:{ ...requestActionStyles.secondary, flex:1 },secondaryText:{ ...requestActionStyles.secondaryText, fontWeight:'900' },disabled:{opacity:.4}});
