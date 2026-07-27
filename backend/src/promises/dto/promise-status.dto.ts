import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PromiseStatusDto {
  @ApiProperty({
    enum: ['fulfilled', 'partially_fulfilled', 'unfulfilled', 'postponed', 'cancelled_approved'],
    description: 'التطابق مع متطلب M5: Fulfilled=fulfilled، Broken=unfulfilled، Cancelled=cancelled_approved',
  })
  @IsIn(['fulfilled', 'partially_fulfilled', 'unfulfilled', 'postponed', 'cancelled_approved'])
  status!: string;

  @ApiPropertyOptional({ description: 'إلزامي للإخلال/الإلغاء/التأجيل' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'إلزامي للتنفيذ الجزئي: المبلغ المنفذ فعليًا (0 < المبلغ < المتوقع)' })
  @IsOptional() @IsNumber() @Min(0.01)
  fulfilledAmount?: number;

  @ApiPropertyOptional({ description: 'إلزامي للتأجيل: موعد الاستحقاق الجديد (قادم)' })
  @IsOptional() @IsDateString()
  newDueDate?: string;
}
