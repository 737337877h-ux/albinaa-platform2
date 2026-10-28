import {Prisma} from '@prisma/client';
export async function queueHrRequestNotification(tx:Prisma.TransactionClient,request:any,employee:any,event:'created'|'decided'){
 const reviewerEvent=event==='created'||request.status==='cancelled';
 const users=reviewerEvent?await tx.user.findMany({where:{organizationId:employee.organizationId,isActive:true,id:{not:request.submittedBy},userRoles:{some:{role:{rolePermissions:{some:{permission:{code:'hr.requests.review'}}}}}}},select:{id:true}}):await tx.user.findMany({where:{organizationId:employee.organizationId,isActive:true,id:request.submittedBy},select:{id:true}});
 const kind=reviewerEvent?'hr_request_submitted':'hr_request_decided';
 const type=request.kind==='advance'?'سلفة':'إجازة';
 const title=reviewerEvent?(request.status==='cancelled'?`أُلغي طلب ${type}`:`طلب ${type} يحتاج المراجعة`):`طلب ${type}: ${request.status==='approved'?'تمت الموافقة':'تم الرفض'}`;
 // No amounts, leave reasons or medical details on the lock screen.
 const payload={requestId:request.id,requestKind:request.kind,decision:request.status,title,message:reviewerEvent?'يوجد تحديث في طلبات الموظفين':'راجع تفاصيل القرار داخل التطبيق',href:`/hr/requests#request-${request.id}`,reviewerEvent};
 for(const u of users){const n=await tx.notification.create({data:{userId:u.id,kind,payload}});await tx.hrPushDelivery.create({data:{id:n.id,userId:u.id,kind,payload}});}
}
