import React from 'react';
import {Alert} from 'react-native';
import {useAuth} from '../store/auth-context';
import {ToolPage,ToolCard,ToolField,ToolButton,ToolText,ToolState,useToolData} from '../components/native-tools';
import {parseFlexibleDate,displayDateFromIso} from '../utils/date-input';
import {exportReport} from '../utils/report-export';
const number=(v:unknown)=>v==null?'غير محدد':Number(v).toLocaleString('en-US',{maximumFractionDigits:4});
export default function CollectorPerformance(){
 const {user}=useAuth();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [from,setFrom]=React.useState(displayDateFromIso(today.slice(0,7)+'-01')),[to,setTo]=React.useState(displayDateFromIso(today)),[range,setRange]=React.useState({from:today.slice(0,7)+'-01',to:today}),[busy,setBusy]=React.useState(false);
 const path=`/reports/collector-performance?from=${range.from}&to=${range.to}`,query=useToolData<any>(path);
 return <ToolPage title="أداء المحصلين حسب الفترة" refreshing={query.isRefetching} onRefresh={()=>void query.refetch()}>
  <ToolField label="من تاريخ" value={from} onChangeText={setFrom} keyboardType="number-pad"/>
  <ToolField label="إلى تاريخ" value={to} onChangeText={setTo} keyboardType="number-pad"/>
  <ToolButton title="عرض التقرير" disabled={query.isFetching} onPress={()=>{const a=parseFlexibleDate(from),b=parseFlexibleDate(to);if(!a||!b||a.iso>b.iso)return Alert.alert('الفترة غير صحيحة','راجع تاريخ البداية والنهاية.');setRange({from:a.iso,to:b.iso});if(a.iso===range.from&&b.iso===range.to)void query.refetch();}}/>
  <ToolText>الفترة تشمل اليومين بتوقيت عدن، حتى 366 يومًا. السندات المعتمدة فقط؛ طلبات القبض غير المرحلة مستبعدة. كل عملة مستقلة، والمساهمة ليست عمولة.</ToolText>
  <ToolState query={query}/>
  {query.data&&!query.isError&&<>
   <ToolText title>الفترة: {displayDateFromIso(query.data.from)} — {displayDateFromIso(query.data.to)}</ToolText>
   <ToolText>آخر لقطة Oracle: {query.data.oracleSnapshotAt?new Date(query.data.oracleSnapshotAt).toLocaleString('ar-YE'):'غير متاحة'}</ToolText>
   {!query.data.oracleSnapshotAt&&<ToolText>لا تتوفر لقطة Oracle منشورة؛ المعروض من تحصيلات المنصة فقط.</ToolText>}
   {query.data.scope==='self'&&<ToolText>يعرض التقرير أداءك فقط؛ نسبة الفريق تحتاج صلاحية الرؤية الشاملة.</ToolText>}
   {user?.permissions.includes('reports.export')&&<ToolButton title={busy?'جارٍ تجهيز Excel...':'حفظ أو مشاركة Excel للفترة المعروضة'} disabled={busy||query.isFetching} onPress={()=>{setBusy(true);void exportReport(`/reports/collector-performance.xlsx?from=${range.from}&to=${range.to}`,`collector-performance-${range.from}-${range.to}.xlsx`).catch(e=>Alert.alert('تعذر التصدير',e.message)).finally(()=>setBusy(false));}}/>}
   {query.data.totals.map((r:any)=><ToolCard key={r.currency}><ToolText title>الإجمالي: {number(r.amount)} {r.currency}</ToolText></ToolCard>)}
   <ToolText title>التحصيل والأهداف</ToolText>
   {query.data.rows.map((r:any)=><ToolCard key={r.collectorId+r.currency}><ToolText title>{r.collectorNo??'—'} — {r.collectorName} • {r.currency}</ToolText><ToolText>التحصيل: {number(r.amount)} {r.currency}</ToolText><ToolText>السندات: {r.receipts} • العملاء: {r.customers}</ToolText><ToolText>المساهمة: {r.sharePercent==null?'—':r.sharePercent+'%'}</ToolText><ToolText>الهدف النسبي: {number(r.target)} • الإنجاز: {r.targetAttainment==null?'—':r.targetAttainment+'%'}</ToolText></ToolCard>)}
   <ToolText>الهدف الشهري موزع على أيام الفترة التقويمية؛ غياب هدف أحد الأشهر يعني أن هدف الفترة غير محدد.</ToolText>
   <ToolText title>المتابعات والوعود</ToolText>
   {query.data.activity.map((r:any)=><ToolCard key={r.collectorId}><ToolText title>{r.collectorNo??'—'} — {r.collectorName}{r.active?'':' (غير نشط)'}</ToolText><ToolText>المتابعات: {r.followups} • العملاء المتابَعون: {r.followedCustomers}</ToolText><ToolText>المسندون حاليًا: {r.assignedCustomers}</ToolText><ToolText>وعود أُنشئت: {r.promisesCreated} • تستحق بالفترة: {r.promisesDue}</ToolText><ToolText>منفذة: {r.promisesFulfilled} • متأخرة: {r.promisesOverdue}</ToolText></ToolCard>)}
   <ToolText>المتابعات لمن سجّلها خلال الفترة. حالات الوعود الحالية تخص مواعيد الاستحقاق داخل الفترة.</ToolText>
  </>}
 </ToolPage>;
}
