import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'مشرف تحصيل', description: 'اسم الدور' })
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'هل هو دور نظامي؟ (افتراضي: false)' })
  isSystem?: boolean;
}