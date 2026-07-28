import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryAuditDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  entityTable?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  to?: string;
}
