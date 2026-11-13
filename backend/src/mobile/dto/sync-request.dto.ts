import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateBy } from 'class-validator';
import {validSyncSectionVersions} from '../mobile-sync-delta';

export class SyncRequestDto {
  @ApiPropertyOptional({ description: 'آخر token تمت مزامنته' })
  @IsOptional() @IsString()
  lastSyncToken?: string;

  @ApiPropertyOptional({ description: 'إصدار دليل الأصناف المحفوظ بنجاح على الهاتف' })
  @IsOptional() @IsString() @MaxLength(150)
  inventoryCatalogVersion?: string;

  @ApiPropertyOptional({description:'بصمات الأقسام المحفوظة بنجاح لتجنب إعادة تنزيل البيانات غير المتغيرة'})
  @IsOptional()
  @ValidateBy({name:'syncSectionVersions',validator:{validate:validSyncSectionVersions,defaultMessage:()=> 'بصمات المزامنة غير صالحة'}})
  syncSectionVersions?: Record<string,string>;
}
