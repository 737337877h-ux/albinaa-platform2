import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateFollowupDto {
  @ApiProperty() @IsUUID()
  customerId!: string;

  @ApiProperty({ description: 'نوع المتابعة (من followup_types)' }) @IsUUID()
  typeId!: string;

  @ApiProperty({ description: 'النتيجة إلزامية — لا متابعة بلا نتيجة (قاعدة معتمدة)' }) @IsUUID()
  resultId!: string;

  @ApiPropertyOptional({ description: 'وقت المتابعة (افتراضي: الآن)' })
  @IsOptional() @IsDateString()
  followupAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'موعد المتابعة القادمة' })
  @IsOptional() @IsDateString()
  nextFollowupDate?: string;

  @ApiPropertyOptional({ description: 'المبلغ المتوقع (يتطلب عملة)' })
  @IsOptional() @IsNumber() @Min(0.01)
  expectedAmount?: number;

  @ApiPropertyOptional({ example: 'YER' })
  @IsOptional() @IsString() @MaxLength(3)
  expectedCurrency?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber()
  visitLat?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber()
  visitLng?: number;
}
