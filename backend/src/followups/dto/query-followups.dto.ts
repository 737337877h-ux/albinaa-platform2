import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryFollowupsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  customerId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  collectorUserId?: string;

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
