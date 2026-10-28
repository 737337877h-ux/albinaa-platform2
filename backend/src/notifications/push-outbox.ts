import {Prisma} from '@prisma/client';
export async function createQueuedNotification(tx:Prisma.TransactionClient,data:Prisma.NotificationUncheckedCreateInput){
 const notification=await tx.notification.create({data});
 await tx.hrPushDelivery.create({data:{id:notification.id,userId:notification.userId,kind:notification.kind,payload:notification.payload as Prisma.InputJsonValue}});
 return notification;
}
