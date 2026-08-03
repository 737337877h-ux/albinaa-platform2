import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReverseCustomerMergeDto {
  @ApiProperty({ example: 'تراجع', description: 'تأكيد صريح لإرجاع السجلات إلى العميل السابق' })
  @Equals('تراجع')
  confirmText!: 'تراجع';

  @ApiPropertyOptional({ description: 'سبب التراجع' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
