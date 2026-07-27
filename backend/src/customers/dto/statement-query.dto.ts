import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class StatementQueryDto {
  @ApiProperty({ description: 'العملة (كشف الحساب دائمًا لعملة واحدة)', example: 'YER' })
  @IsString() @MaxLength(3)
  currency!: string;

  @ApiPropertyOptional({ description: 'من تاريخ (شامل)' })
  @IsOptional() @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'إلى تاريخ (شامل)' })
  @IsOptional() @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}
