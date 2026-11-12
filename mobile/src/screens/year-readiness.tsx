import React from 'react';
import {ToolPage,ToolCard,ToolText,ToolState,useToolData} from '../components/native-tools';
export default function YearReadiness(){
 const query=useToolData<any>('/oracle-monitoring/year-readiness');
 return <ToolPage title="الاستعداد لسنة 2027" onRefresh={()=>void query.refetch()} refreshing={query.isRefetching}>
  <ToolText>الانتقال يحتاج اعتماد مصدر السنة الجديدة ومطابقة الأرصدة. هذا فحص للقراءة فقط، واعتماد الانتقال خطوة مستقلة.</ToolText><ToolState query={query}/>
  {query.data&&!query.isError&&<><ToolText>المصدر الحالي: {query.data.currentSource} • سنة المصدر: {query.data.currentSourceYear??'غير محددة'}</ToolText>{query.data.checks.map((check:any)=><ToolCard key={check.id}><ToolText title>{check.title} — {check.status==='ready'?'تم التحقق':'يلزم مراجعة'}</ToolText><ToolText>{check.message}</ToolText>{check.checkedAt&&<ToolText>وقت اللقطة: {new Date(check.checkedAt).toLocaleString('ar-YE')}</ToolText>}</ToolCard>)}</>}
 </ToolPage>;
}
