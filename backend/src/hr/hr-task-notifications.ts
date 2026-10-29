import {Prisma} from '@prisma/client';
export async function queueHrTaskNotification(tx:Prisma.TransactionClient, organizationId:string, actorId:string, taskId:string, assignment:any, event:'assigned'|'submit'|'complete'|'return'|'cancel') {
 const reviewerEvent=event==='submit';
 const employee=assignment.employee??await tx.hrEmployee.findUnique({where:{id:assignment.employeeId}});
 if(!employee?.active)return;
 const users=await tx.user.findMany({where:{organizationId,isActive:true,...(reviewerEvent?{id:{not:actorId},userRoles:{some:{role:{rolePermissions:{some:{permission:{code:'hr.tasks.manage'}}}}}}}:{id:employee.loginUserId??'00000000-0000-0000-0000-000000000000'})},select:{id:true}});
 const states={assigned:['assigned','مهمة موظف جديدة'],submit:['submitted','إنجاز مهمة يحتاج المراجعة'],complete:['completed','تم اعتماد إنجاز مهمتك'],return:['returned','أُعيدت مهمتك للتعديل'],cancel:['cancelled','أُلغيت مهمة مسندة إليك']};
 const [suffix,title]=states[event],kind='hr_task_'+suffix;
 const payload={taskId,assignmentId:assignment.id,title,message:reviewerEvent?'راجع إفادة الموظف ومرفقات الإنجاز داخل التطبيق':'افتح المهمة للاطلاع على التفاصيل والمرفقات',reviewerEvent,href:`/hr/tasks#assignment-${assignment.id}`};
 for(const u of users){const n=await tx.notification.create({data:{userId:u.id,kind,payload}});await tx.hrPushDelivery.create({data:{id:n.id,userId:u.id,kind,payload}});}
}
