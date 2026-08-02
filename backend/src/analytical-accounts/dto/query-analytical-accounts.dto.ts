import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ANALYTICAL_ACCOUNT_CATEGORIES } from './create-analytical-account.dto';

export class QueryAnalyticalAccountsDto {
  @ApiPropertyOptional({ enum: ANALYTICAL_ACCOUNT_CATEGORIES })
  @IsOptional() @IsIn(ANALYTICAL_ACCOUNT_CATEGORIES)
  category?: (typeof ANALYTICAL_ACCOUNT_CATEGORIES)[number];

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(3)
  currencyCode?: string;

  @ApiPropertyOptional({ description: 'Search by account number, account name, person name, or employee number' })
  @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive'])
  status?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
