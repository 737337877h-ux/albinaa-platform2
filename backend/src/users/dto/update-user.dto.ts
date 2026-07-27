import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** تعديل بيانات المستخدم — بدون كلمة المرور (لها مسار خاص) وبدون الحالة (لها مسار خاص). */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  branchId?: string;
}
