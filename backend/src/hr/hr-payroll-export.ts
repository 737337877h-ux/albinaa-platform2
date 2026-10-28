export function payrollCsv(report:any){
 const cell=(v:unknown)=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const status=report.approval?(report.approval.status==='approved'?'معتمد — غير مصروف':'نسخة سابقة أُعيد فتحها — غير مصروفة'):'مسودة غير معتمدة — غير مصروفة';
 const rows:any[][]=[['الشهر',report.month,'الحالة',status,'النسخة',report.approval?.revision??'مسودة'],['رقم الموظف','الموظف','العملة','الراتب الأساسي','البدل','الحوافز','المسحوبات','الخصومات','الأقساط اليدوية','أقساط السلف التلقائية','خصم الغياب','خصم التأخير','الصافي','ملاحظات']];
 for(const r of report.rows){const c=r.calculation;rows.push([r.employee.employeeNo,r.employee.fullName,c?.currency,c?.baseSalary,c?.fixedAllowance,c?.incentives,c?.reviewedWithdrawals,c?.deductions,c?.installments,c?.automaticInstallments??0,c?.absenceDeduction??0,c?.lateDeduction??0,c?.net,r.error??c?.warnings.join('؛ ')]);}
 return {filename:`payroll-${report.month}-${report.approval?.revision??'draft'}.csv`,content:'\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')};
}
