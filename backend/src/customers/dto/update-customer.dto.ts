import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateCustomerDto } from './create-customer.dto';

/** التعديل لا يشمل الكود (مفتاح المطابقة مع النظام المحاسبي — تغييره إجراء خاص). */
export class UpdateCustomerDto extends PartialType(
  OmitType(CreateCustomerDto, ['externalCustomerCode'] as const),
) {}
