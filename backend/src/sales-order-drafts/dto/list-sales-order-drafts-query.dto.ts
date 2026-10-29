import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListSalesOrderDraftsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @IsIn(['all', 'cash', 'credit', 'other'])
  kind: 'all' | 'cash' | 'credit' | 'other' = 'all';

  @IsOptional() @IsIn(['all', 'draft_review', 'ready_for_approval', 'archived', 'cancelled'])
  status: 'all' | 'draft_review' | 'ready_for_approval' | 'archived' | 'cancelled' = 'all';

  @IsOptional() @IsString() @MaxLength(100)
  search?: string;
}
