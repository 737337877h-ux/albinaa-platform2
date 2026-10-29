import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class MergeDuplicateDto {
  @ApiProperty({ description: 'معرّف العميل الذي سيبقى كسجل أساسي' })
  @IsUUID()
  masterCustomerId!: string;

  @ApiProperty({ example: 'دمج', description: 'تأكيد صريح للعملية الحساسة' })
  @Equals('دمج')
  confirmText!: 'دمج';

  @ApiPropertyOptional({ description: 'سبب اختيار السجل الأساسي' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
