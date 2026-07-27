import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AssignCollectorDto {
  @ApiProperty({ description: 'المحصل الجديد' })
  @IsUUID()
  collectorId!: string;

  @ApiPropertyOptional({ description: 'تاريخ السريان (افتراضي: اليوم)' })
  @IsOptional() @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'سبب النقل' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
