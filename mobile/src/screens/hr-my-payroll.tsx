import React from 'react';
import { ToolCard, ToolPage, ToolSelect, ToolState, ToolText, useToolData } from '../components/native-tools';

const labels: Record<string,string> = { baseSalary:'الراتب الأساسي', fixedAllowance:'البدلات الثابتة', incentives:'الحوافز', reviewedWithdrawals:'المسحوبات المعتمدة', deductions:'الخصومات اليدوية', absenceDeduction:'خصم الغياب', installments:'الأقساط المدخلة', automaticInstallments:'أقساط السلف المعتمدة', net:'صافي الراتب' };
export default function HrMyPayroll() {
  const [month,setMonth]=React.useState('2026-10');
  const query=useToolData<any>(`/hr/payroll/mine?month=${month}`);
  return <ToolPage title="كشف راتبي" onRefresh={()=>void query.refetch()} refreshing={query.isRefetching}>
    <ToolSelect label="الشهر" value={month} onChange={setMonth} options={[{id:'2026-10',label:'أكتوبر 2026'},{id:'2026-11',label:'نوفمبر 2026'},{id:'2026-12',label:'ديسمبر 2026'}]}/>
    <ToolState query={query}/>
    {query.data&&<><ToolText>{query.data.employee.fullName}</ToolText>{!query.data.calculation?<ToolCard><ToolText>لا يوجد كشف راتب معتمد لك لهذا الشهر حتى الآن.</ToolText></ToolCard>:<><ToolText>كشف معتمد · {query.data.calculation.currency}</ToolText>{Object.entries(labels).map(([key,label])=><ToolCard key={key}><ToolText title={key==='net'}>{label}: {query.data.calculation[key]??'غير محدد'} {query.data.calculation.currency}</ToolText></ToolCard>)}</>}</>}
  </ToolPage>;
}
