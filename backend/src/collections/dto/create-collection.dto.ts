import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateCollectionDto {
  @ApiProperty() @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ description: 'افتراضي: المحصل الحالي إن كان المستخدم محصلاً' })
  @IsOptional() @IsUUID()
  collectorId?: string;

  @ApiPropertyOptional({ description: 'الفرع — افتراضي: فرع المحصل ثم فرع العميل' })
  @IsOptional() @IsUUID()
  branchId?: string;

  @ApiProperty({ example: 'YER' })
  @IsString() @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ description: 'لا صفر ولا سالب (قاعدة معتمدة)', example: 25000 })
  @IsNumber() @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ description: 'وقت التحصيل (افتراضي: الآن)' })
  @IsOptional() @IsDateString()
  collectedAt?: string;

  @ApiProperty({ description: 'طريقة الدفع' }) @IsUUID()
  methodId!: string;

  @ApiPropertyOptional({ description: 'المرجع / رقم التحويل' })
  @IsOptional() @IsString() @MaxLength(100)
  referenceNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  bankName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  chequeNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  chequeDate?: string;

  @ApiPropertyOptional({ description: 'رقم السند' })
  @IsOptional() @IsString() @MaxLength(100)
  receiptNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
