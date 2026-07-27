import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class GrantRolesDto {
  @ApiProperty({ type: [String], description: 'معرّفات الأدوار المراد منحها' })
  @IsArray() @ArrayMinSize(1) @IsUUID(undefined, { each: true })
  roleIds!: string[];
}
