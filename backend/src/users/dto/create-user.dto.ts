import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'collector1' })
  @IsString() @MinLength(2) @MaxLength(100)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'اسم المستخدم: أحرف لاتينية وأرقام و . _ - فقط' })
  username!: string;

  @ApiProperty({ example: 'أحمد المحصل' })
  @IsString() @MinLength(2) @MaxLength(200)
  fullName!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @ApiProperty({ description: '8 أحرف على الأقل وتتضمن رقمًا وحرفًا' })
  @IsString() @MinLength(8) @MaxLength(200)
  @Matches(/(?=.*[0-9])(?=.*[A-Za-z\u0600-\u06FF])/, { message: 'كلمة المرور يجب أن تتضمن رقمًا وحرفًا' })
  password!: string;

  @ApiPropertyOptional({ description: 'معرّف الفرع' })
  @IsOptional() @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'معرّفات الأدوار الابتدائية', type: [String] })
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true })
  roleIds?: string[];
}
