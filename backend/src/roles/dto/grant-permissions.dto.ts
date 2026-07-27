import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class GrantPermissionsDto {
  @ApiProperty({ type: [String], description: 'معرّفات الصلاحيات المراد إضافتها للدور' })
  @IsArray() @ArrayMinSize(1) @IsUUID(undefined, { each: true })
  permissionIds!: string[];
}
