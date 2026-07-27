import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class QueryCollectionsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  customerId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ enum: ['recorded', 'handed_to_cashier', 'matched', 'approved', 'reversed'] })
  @IsOptional() @IsIn(['recorded', 'handed_to_cashier', 'matched', 'approved', 'reversed'])
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
