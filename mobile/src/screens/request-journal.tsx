import { requestActionStyles } from '../components/request-action-styles';
import React from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fetchOracleRequestCatalog, fetchOracleRequestCurrencies } from '../api/endpoints';
import RequestSearchPicker, { RequestPickerOption } from '../components/request-search-picker';
import {
  hasDebitAndCredit,
  normalizeJournalReference,
  ORACLE_JOURNAL_REFERENCE_MAX_LENGTH,
} from '../utils/journal-request';
import { colors, radius, shadow } from '../theme';
import { saveOfflineDraft, submitOfflineDraft } from '../utils/offline-request';
import { useSync } from '../store/sync-context';

type Line={id:string;direction:'debit'|'credit';category:string;party?:RequestPickerOption;account?:RequestPickerOption;currency?:RequestPickerOption;amount:string;description:string;expanded:boolean};
const makeLine=(direction:'debit'|'credit'):Line=>({id:`${Date.now()}-${Math.random()}`,direction,category:'other',amount:'',description:'',expanded:true});
const categories=[['customers','العملاء'],['vendors','الموردون'],['employees','الموظفون'],['debtors','المدينون'],['creditors','الدائنون'],['custodies','العهد'],['bank_accounts','حسابات البنوك'],['other','أخرى']] as const;
const newReference=()=>`mobile-journal:${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const linkedAccountOptions=(party?:RequestPickerOption):RequestPickerOption[]=>(((party?.raw as any)?.linkedAccounts??[]) as any[]).map((account)=>({key:`${account.accountCode}|${account.analyticalAccountCode}|${account.analyticalType}`,label:account.analyticalAccountName||account.accountName,hint:`${account.accountCode} / ${account.analyticalAccountCode}`,raw:account}));
const resolvedAccount=(line:Line)=>line.account??(linkedAccountOptions(line.party).length===1?linkedAccountOptions(line.party)[0]:undefined);

export default function RequestJournalScreen({navigation,route}:any){
  const draft=route.params?.draftPayload as any|undefined;
  const draftId=String(route.params?.draftOperationId||draft?.externalReference||newReference());
  const restoredLines=React.useMemo(()=>Array.isArray(draft?.lines)&&draft.lines.length?draft.lines.map((row:any,index:number)=>{const accountRaw={accountCode:String(row.accountCode||''),analyticalAccountCode:String(row.analyticalAccountCode||''),analyticalType:Number(row.analyticalType||0)};return{id:`draft-${index}`,direction:row.direction==='credit'?'credit':'debit',category:'other',party:{key:String(row.analyticalAccountCode||row.accountCode||index),label:String(row.partyName||row.analyticalAccountCode||row.accountCode||'طرف القيد'),raw:{linkedAccounts:[accountRaw]}},account:{key:`${accountRaw.accountCode}|${accountRaw.analyticalAccountCode}|${accountRaw.analyticalType}`,label:String(row.accountName||row.analyticalAccountCode||row.accountCode),raw:accountRaw},currency:{key:String(row.currencyCode||''),label:String(row.currencyCode||'')},amount:String(row.amount??''),description:String(row.description||''),expanded:true} as Line;}):[makeLine('debit'),makeLine('credit')],[]);
  const [description,setDescription]=React.useState(String(draft?.description||'قيد يومي من تطبيق البناء الراقي'));
  const [referenceNo,setReferenceNo]=React.useState(String(draft?.referenceNo||''));
  const [lines,setLines]=React.useState<Line[]>(restoredLines);
  const [externalReference]=React.useState(()=>String(draft?.externalReference||draftId));
  const {triggerSync}=useSync();
  const catalog=useQuery({queryKey:['mobile-journal-catalog'],queryFn:async()=> (await fetchOracleRequestCatalog('payment')).data});
  const currencies=useQuery({queryKey:['mobile-request-currencies'],queryFn:async()=> (await fetchOracleRequestCurrencies()).data});
  const currencyOptions=((currencies.data?.currencies??[]) as any[]).map((row)=>({key:row.code,label:`${row.nameAr} — ${row.code}`,raw:row}));
  React.useEffect(()=>{const defaultCurrency=currencyOptions.find((option)=>(option.raw as any)?.local)??currencyOptions[0];if(defaultCurrency)setLines((rows)=>rows.map((row)=>row.currency?row:{...row,currency:defaultCurrency}));},[currencies.data]);
  const update=(id:string,change:Partial<Line>)=>{setLines((rows)=>rows.map((row)=>row.id===id?{...row,...change}:row));};
  const totals=React.useMemo(()=>{const result:Record<string,{debit:number;credit:number}>={};for(const line of lines){const code=line.currency?.key||'—';result[code]??={debit:0,credit:0};result[code][line.direction]+=Number(line.amount)||0;}return result;},[lines]);
  const payload=React.useMemo(()=>({externalReference,description,referenceNo:referenceNo||null,lines:lines.map((line)=>{const account=resolvedAccount(line)?.raw as any;return{direction:line.direction,currencyCode:line.currency?.key??'',amount:Number(line.amount),accountCode:account?.accountCode??'',analyticalAccountCode:account?.analyticalAccountCode??'',analyticalType:account?.analyticalType??0,description:line.description||description};})}),[externalReference,description,referenceNo,lines]);
  const validate=()=>{if(!description.trim()||lines.some((line)=>!line.party||!resolvedAccount(line)||!line.currency||!(Number(line.amount)>0))){Alert.alert('بيانات ناقصة','أكمل الطرف والحساب والعملة والمبلغ لكل سطر.');return false;}if(!hasDebitAndCredit(lines)){Alert.alert('بيانات ناقصة','يجب أن يحتوي القيد على طرف مدين وطرف دائن.');return false;}return true;};
  const saveOffline=async()=>{if(!validate())return;await saveOfflineDraft({kind:'journal',title:'قيد يومي',endpoint:'/oracle-test-requests/journals',operationId:draftId,payload});Alert.alert('حُفظت المسودة','بقيت في قاعدة الهاتف فقط ويمكن تعديلها من عمليات ONYX.',[{text:'حسنًا',onPress:()=>navigation.goBack()}]);};
  const inspectAndSend=async()=>{if(!validate())return;await submitOfflineDraft({kind:'journal',title:'قيد يومي',endpoint:'/oracle-test-requests/journals',operationId:draftId,payload});void triggerSync().catch(()=>undefined);Alert.alert('بدأ الفحص والإرسال','سيفحص التطبيق توازن القيد أولًا، ولن يحفظه إذا لم يجتز الفحص.',[{text:'حسنًا',onPress:()=>navigation.goBack()}]);};
  if(catalog.isLoading||currencies.isLoading)return <View style={styles.loading}><ActivityIndicator color={colors.primary}/><Text style={styles.loadingText}>جار تحميل دليل الحسابات من IAS20261…</Text></View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={70}><ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {(catalog.isError||currencies.isError)&&<View style={styles.error}><Text style={styles.errorText}>تعذر تحميل الحسابات والعملات. لم تُرسل أي بيانات.</Text></View>}
    <Field label="بيان القيد" value={description} onChangeText={setDescription}/><Field label="رقم المرجع (حد أقصى 15 حرفًا)" value={referenceNo} maxLength={ORACLE_JOURNAL_REFERENCE_MAX_LENGTH} onChangeText={(value)=>setReferenceNo(normalizeJournalReference(value))}/>
    <View style={styles.totals}><Text style={styles.rateHint}>يُحسب التوازن بعد تحويل العملات بسعر نظام IAS20261</Text>{Object.entries(totals).map(([code,row])=><View key={code} style={styles.totalRow}><Text style={styles.totalCode}>{code}</Text><Text style={styles.debit}>مدين (عليه) {row.debit.toLocaleString('en-US')}</Text><Text style={styles.credit}>دائن (له) {row.credit.toLocaleString('en-US')}</Text></View>)}</View>
    <View style={styles.gridLabels}><Text style={styles.gridLabel}>مدين/دائن</Text><Text style={styles.gridLabel}>العملة</Text><Text style={styles.gridLabel}>المبلغ والبيان</Text></View>
    {lines.map((line,index)=>{const parties=((catalog.data?.parties?.[line.category]??[]) as any[]);const partyOptions=parties.map((party)=>({key:String(party.code),label:party.nameAr||party.code,hint:String(party.code),raw:party}));const accountOptions=linkedAccountOptions(line.party);return <View key={line.id} style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={()=>update(line.id,{expanded:!line.expanded})}><Ionicons name={line.expanded?'chevron-up':'chevron-down'} size={19} color={colors.primary}/><Text numberOfLines={2} style={styles.cardTitle}>سطر {index+1} · {line.direction==='debit'?'مدين · عليه':'دائن · له'} · {line.amount||'0'} {line.currency?.key||''} · {line.party?.label??'لم يحدد'}</Text></TouchableOpacity>
      {line.expanded&&<View style={styles.body}>
        <View style={styles.entryGrid}><View style={styles.gridCell}><View style={styles.segment}>{(['debit','credit'] as const).map((direction)=><TouchableOpacity key={direction} style={[styles.segmentBtn,line.direction===direction&&styles.segmentActive]} onPress={()=>update(line.id,{direction})}><Text style={[styles.segmentText,line.direction===direction&&styles.segmentTextActive]}>{direction==='debit'?'مدين · عليه':'دائن · له'}</Text></TouchableOpacity>)}</View></View><View style={styles.gridCell}><RequestSearchPicker label="العملة" value={line.currency} options={currencyOptions} onSelect={(currency)=>update(line.id,{currency})}/></View></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{categories.map(([key,label])=><TouchableOpacity key={key} style={[styles.category,line.category===key&&styles.categoryActive]} onPress={()=>update(line.id,{category:key,party:undefined,account:undefined})}><Text style={[styles.categoryText,line.category===key&&styles.categoryTextActive]}>{label}</Text></TouchableOpacity>)}</ScrollView>
        <RequestSearchPicker label="اسم الطرف" value={line.party} options={partyOptions} onSelect={(party)=>{const options=linkedAccountOptions(party);update(line.id,{party,account:options.length===1?options[0]:undefined});}}/>
        {accountOptions.length>1&&<RequestSearchPicker label="اختر الحساب" value={line.account} options={accountOptions} onSelect={(account)=>update(line.id,{account})}/>}
        <View style={styles.entryGrid}><View style={styles.gridCell}><Field label="المبلغ" value={line.amount} keyboardType="decimal-pad" onChangeText={(amount)=>update(line.id,{amount})}/></View><View style={styles.gridCell}><Field label="بيان السطر" value={line.description} onChangeText={(value)=>update(line.id,{description:value})}/></View></View>
        {lines.length>2&&<TouchableOpacity onPress={()=>setLines((rows)=>rows.filter((row)=>row.id!==line.id))}><Text style={styles.delete}>حذف السطر</Text></TouchableOpacity>}
      </View>}
    </View>})}
    <TouchableOpacity style={styles.add} onPress={()=>setLines((rows)=>[...rows,makeLine('debit')])}><Ionicons name="add-circle-outline" size={20} color={colors.primary}/><Text style={styles.addText}>إضافة سطر قيد</Text></TouchableOpacity>
    <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={saveOffline}><Text style={styles.secondaryText}>حفظ مسودة</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={inspectAndSend}><Text style={styles.primaryText}>فحص وإرسال الطلب</Text></TouchableOpacity></View>
  </ScrollView></KeyboardAvoidingView>;
}

function Field({label,value,onChangeText,keyboardType,maxLength}:{label:string;value:string;onChangeText:(value:string)=>void;keyboardType?:any;maxLength?:number}){return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} maxLength={maxLength} textAlign="right" placeholderTextColor={colors.muted}/></View>;}
const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.background},
  content:{padding:12,paddingBottom:40},
  loading:{flex:1,alignItems:'center',justifyContent:'center',gap:10,backgroundColor:colors.background},
  loadingText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'800'},
  error:{backgroundColor:'#FDECEC',borderRadius:radius.md,padding:12,marginBottom:10},
  errorText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.danger,textAlign:'right',fontWeight:'800'},
  field:{marginBottom:9},
  label:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900',textAlign:'right',marginBottom:5},
  input:{minHeight:48,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:10,color:colors.ink},
  totals:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.success,borderRadius:radius.md,padding:9,marginBottom:9},
  rateHint:{ fontFamily: 'TajawalBold',color:colors.muted,textAlign:'right',fontWeight:'800',fontSize:13,marginBottom:6},
  totalRow:{flexDirection:'row-reverse',alignItems:'center',justifyContent:'space-between',gap:5,paddingVertical:3},
  totalCode:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900'},
  debit:{ fontFamily: 'TajawalBold',color:colors.danger,fontWeight:'900',fontSize:13},
  credit:{ fontFamily: 'TajawalBold',color:colors.success,fontWeight:'900',fontSize:13},
  gridLabels:{flexDirection:'row-reverse',justifyContent:'space-around',paddingHorizontal:8,marginBottom:5},
  gridLabel:{ fontFamily: 'TajawalBold',color:colors.muted,fontSize:13,fontWeight:'800'},
  card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,marginBottom:9,...shadow},
  header:{minHeight:54,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12},
  cardTitle:{ fontFamily: 'TajawalBold', fontSize: 15,flex:1,color:colors.ink,textAlign:'right',fontWeight:'900'},
  body:{borderTopWidth:1,borderTopColor:colors.line,padding:10},
  entryGrid:{flexDirection:'row-reverse',gap:7},
  gridCell:{flex:1},
  segment:{flexDirection:'row-reverse',gap:6,marginTop:22},
  segmentBtn:{flex:1,minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,alignItems:'center',justifyContent:'center'},
  segmentActive:{backgroundColor:colors.primary},
  segmentText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900'},
  segmentTextActive:{color:'#fff'},
  categories:{gap:6,paddingBottom:9},
  category:{paddingHorizontal:9,paddingVertical:7,borderRadius:999,borderWidth:1,borderColor:colors.line},
  categoryActive:{backgroundColor:colors.primary},
  categoryText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'800'},
  categoryTextActive:{color:'#fff'},
  delete:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.danger,fontWeight:'900'},
  add:{minHeight:48,flexDirection:'row-reverse',gap:7,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.primary,borderRadius:radius.sm},
  addText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},
  actions:{flexDirection:'row-reverse',gap:9,marginTop:12},
  primary:{ ...requestActionStyles.primary, flex:2 },
  primaryText:{ ...requestActionStyles.primaryText, fontWeight:'900' },
  secondary:{ ...requestActionStyles.secondary, flex:1 },
  secondaryText:{ ...requestActionStyles.secondaryText, fontWeight:'900' },
  disabled:{opacity:.4},
});
