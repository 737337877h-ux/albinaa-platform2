import {BadRequestException} from '@nestjs/common';
import {Prisma} from '@prisma/client';

export function notificationApplicationScope(application?:string):Prisma.NotificationWhereInput {
  if (!application) return {};
  if (!['operations','collector'].includes(application)) throw new BadRequestException('قناة التطبيق غير معروفة');
  const business:Prisma.NotificationWhereInput = {OR:['inventory_','quotation_','sales_order_','purchase_'].map(prefix=>({kind:{startsWith:prefix}}))};
  const hr:Prisma.NotificationWhereInput={kind:{startsWith:'hr_'}};
  if (application==='operations') return {OR:[business,hr,{kind:'sync_failed'}]};
  return {NOT:[business,{kind:{in:['hr_task_submitted','hr_request_submitted']}}]};
}
