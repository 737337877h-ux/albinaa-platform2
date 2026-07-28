import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadReceiptDto {
  @ApiProperty({ description: 'معرّف التحصيل' })
  @IsUUID()
  collectionId!: string;

  @ApiPropertyOptional({ description: 'ملاحظة' })
  @IsOptional() @IsString()
  notes?: string;
}
