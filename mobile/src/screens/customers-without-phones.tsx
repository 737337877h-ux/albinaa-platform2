import React from 'react';
import {Alert} from 'react-native';
import {useAuth} from '../store/auth-context';
import {ToolPage,ToolCard,ToolField,ToolSelect,ToolButton,ToolText,ToolState,useToolData} from '../components/native-tools';
import {exportReport} from '../utils/report-export';

export default function CustomersWithoutPhones({navigation}:any){
 const {user}=useAuth();
 const [search,setSearch]=React.useState(''),[applied,setApplied]=React.useState(''),[collector,setCollector]=React.useState(''),[accountClass,setClass]=React.useState('customer'),[status,setStatus]=React.useState('active'),[page,setPage]=React.useState(1),[busy,setBusy]=React.useState(false);
 const params=new URLSearchParams({search:applied,accountClass,status,page:String(page),limit:'25'});if(collector)params.set('collectorId',collector);
 const query=useToolData<any>(`/customers/without-phones?${params}`);
 const [collectorOptions,setCollectorOptions]=React.useState<{id:string;name:string}[]>([]);
 React.useEffect(()=>{if(query.data)setCollectorOptions(query.data.collectors);},[query.data]);
 return <ToolPage title="العملاء دون أرقام هاتف" refreshing={query.isRefetching} onRefresh={()=>void query.refetch()}>
  <ToolText>لا يوجد رقم قابل للاستخدام في الهاتفين أو واتساب. النتائج ضمن نطاق العملاء المسندين المسموح لك بعرضهم.</ToolText>
  <ToolField label="اسم العميل أو الكود أو رقم الحساب" value={search} onChangeText={setSearch} onSubmitEditing={()=>{setApplied(search.trim());setPage(1);}}/>
  <ToolButton title="بحث" onPress={()=>{setApplied(search.trim());setPage(1);}}/>
  <ToolSelect label="نوع الحساب" value={accountClass} onChange={v=>{setClass(v);setCollector('');setPage(1);}} options={[{id:'customer',label:'العملاء'},{id:'advance',label:'السلف'}]}/>
  <ToolSelect label="المحصل" value={collector} onChange={v=>{setCollector(v);setPage(1);}} options={[{id:'',label:'كل الإسنادات المتاحة'},{id:'unassigned',label:'غير مسند'},...collectorOptions.map(c=>({id:c.id,label:c.name}))]}/>
  <ToolSelect label="الحالة" value={status} onChange={v=>{setStatus(v);setPage(1);}} options={[{id:'active',label:'نشط'},{id:'inactive',label:'غير نشط'},{id:'all',label:'كل الحالات'}]}/>
  <ToolState query={query}/>
  {query.data&&!query.isError&&<><ToolText title>النتائج: {query.data.total}</ToolText>
   {user?.permissions.includes('reports.export')&&<ToolButton title={busy?'جارٍ تجهيز Excel...':'حفظ أو مشاركة Excel لكل النتائج'} disabled={busy||query.isFetching||!query.data.total} onPress={()=>{setBusy(true);void exportReport(`/customers/without-phones.xlsx?${params}`,'customers-without-phones.xlsx').catch(e=>Alert.alert('تعذر التصدير',e.message)).finally(()=>setBusy(false));}}/>}
   {query.data.items.map((c:any)=><ToolCard key={c.id}><ToolText title>{c.externalCustomerCode} — {c.name}</ToolText><ToolText>رقم الحساب: {c.accountNumber||'—'}</ToolText><ToolText>المحصل: {c.collectorName||'غير مسند'} • المنطقة: {c.region||'—'}</ToolText><ToolText>{c.reason}</ToolText><ToolButton title="فتح حساب العميل" onPress={()=>navigation.navigate('Customer360',{id:c.id})}/></ToolCard>)}
   {!query.data.total&&<ToolText>لا توجد حسابات مطابقة بهذه الفلاتر.</ToolText>}
   <ToolText>صفحة {page} من {query.data.totalPages||1}</ToolText><ToolButton title="السابق" disabled={page<=1||query.isFetching} onPress={()=>setPage(v=>v-1)}/><ToolButton title="التالي" disabled={page>=query.data.totalPages||query.isFetching} onPress={()=>setPage(v=>v+1)}/>
  </>}
 </ToolPage>;
}
