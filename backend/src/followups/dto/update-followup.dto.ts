import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateFollowupDto } from './create-followup.dto';

/** التعديل لا يغيّر العميل. */
export class UpdateFollowupDto extends PartialType(
  OmitType(CreateFollowupDto, ['customerId'] as const),
) {}
