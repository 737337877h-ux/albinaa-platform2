export const platformTools=[
 {route:'BarcodeDesign',title:'تصميم وطباعة الباركود',path:'/inventory/barcodes',permission:'inventory.read',icon:'barcode-outline'},
 {route:'AssignTask',title:'إسناد مهمة تحصيل جديدة',path:'/tasks',permission:'tasks.manage',icon:'add-circle-outline'},
 {route:'AssignHrTask',title:'إسناد مهمة لموظف',path:'/hr/tasks',permission:'hr.tasks.manage',icon:'clipboard-outline'},
 {route:'CollectionKpi',title:'مؤشرات أداء التحصيل',path:'/reports/kpi',permission:'reports.read',icon:'stats-chart-outline'},
 {route:'ManageUsers',title:'المستخدمون',path:'/admin/users',permission:'users.manage',icon:'people-outline'},
 {route:'ManageRoles',title:'الأدوار والصلاحيات',path:'/admin/roles',permission:'users.manage',icon:'shield-checkmark-outline'},
 {route:'ManageCollectors',title:'المحصلون',path:'/admin/collectors',permission:'users.manage',icon:'person-outline'},
 {route:'ManageAssignments',title:'تغيير الإسناد والإسناد الجماعي',path:'/admin/assignments',permission:'customers.transfer',icon:'swap-horizontal-outline'},
] as const;
export function platformOrigin(api:string){
 const u=new URL(api);
 if(u.pathname.replace(/\/$/,'')==='/api')return u.origin;
 if(u.port==='18002'){u.port='3003';return u.origin;}
 if(u.port==='18003'){u.port='3004';return u.origin;}
 throw Error('عنوان المنصة غير معروف لهذا الخادم؛ اختر عنوان المنصة في إعدادات الاتصال');
}
