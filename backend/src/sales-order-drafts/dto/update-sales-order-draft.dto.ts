import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSalesOrderDraftDto {
  @IsOptional() @IsString() @MaxLength(30)
  proposedCustomerCode?: string;

  @IsOptional() @IsString() @MaxLength(250)
  proposedCustomerName?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsIn(['draft_review', 'ready_for_approval', 'archived', 'cancelled'])
  status?: string;
}
