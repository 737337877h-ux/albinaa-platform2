import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangeUsernameDto {
  @ApiProperty({ example: 'collector1', description: 'اسم المستخدم الجديد' })
  @IsString() @MinLength(2) @MaxLength(100)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'اسم المستخدم: أحرف لاتينية وأرقام و . _ - فقط' })
  username!: string;
}
