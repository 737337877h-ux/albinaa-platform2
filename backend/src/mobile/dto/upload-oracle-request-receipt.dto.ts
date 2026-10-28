import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadOracleRequestReceiptDto {
  @ApiProperty({ enum: ['receipt', 'payment'] })
  @IsIn(['receipt', 'payment'])
  kind!: 'receipt' | 'payment';

  @ApiProperty({ description: 'رقم طلب السند في Oracle' })
  @IsString() @MaxLength(60)
  requestNo!: string;

  @ApiPropertyOptional({ description: 'مرجع التطبيق المحلي' })
  @IsOptional() @IsString() @MaxLength(120)
  externalReference?: string;
}
