import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateCollectorDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'رقم المحصل المقابل في IAS20261', minimum: 1, maximum: 32767 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32767)
  oracleCollectorNo?: number;
}
