import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'مشرف تحصيل', description: 'اسم الدور' })
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  name?: string;
}