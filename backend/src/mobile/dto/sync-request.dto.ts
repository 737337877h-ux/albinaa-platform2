import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SyncRequestDto {
  @ApiPropertyOptional({ description: 'آخر token تمت مزامنته' })
  @IsOptional() @IsString()
  lastSyncToken?: string;

  @ApiPropertyOptional({ description: 'إصدار دليل الأصناف المحفوظ بنجاح على الهاتف' })
  @IsOptional() @IsString() @MaxLength(150)
  inventoryCatalogVersion?: string;
}
