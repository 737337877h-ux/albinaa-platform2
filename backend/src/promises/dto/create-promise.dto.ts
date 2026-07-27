import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreatePromiseDto {
  @ApiProperty() @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ description: 'المحصل — افتراضي: المحصل الحالي إن كان المستخدم محصلاً' })
  @IsOptional() @IsUUID()
  collectorId?: string;

  @ApiPropertyOptional({ description: 'تاريخ قطع الوعد (افتراضي: اليوم)' })
  @IsOptional() @IsDateString()
  promiseDate?: string;

  @ApiProperty({ description: 'تاريخ الاستحقاق المتوقع للسداد' })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ example: 50000 })
  @IsNumber() @Min(0.01)
  expectedAmount!: number;

  @ApiProperty({ example: 'YER' })
  @IsString() @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ description: 'طريقة السداد المتوقعة' })
  @IsOptional() @IsUUID()
  expectedMethodId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
