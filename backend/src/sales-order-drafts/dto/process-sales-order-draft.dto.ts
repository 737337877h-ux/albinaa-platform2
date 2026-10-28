import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProcessSalesOrderDraftDto {
  @IsIn(['ready_for_approval', 'archived', 'cancelled', 'draft_review'])
  status!: string;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
