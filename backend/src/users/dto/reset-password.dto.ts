import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * إعادة تعيين كلمة المرور (إجراء إداري).
 * يقبل الحقلين `password` (تستخدمه واجهة التحكم) و `newPassword` (العقد القديم للـ API)
 * لأغراض التوافق — المُتحكِّم يقرأ `newPassword ?? password`.
 */
export class ResetPasswordDto {
  @ApiPropertyOptional({ description: 'كلمة المرور الجديدة (يستخدمه الـ Admin UI)' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'كلمة المرور الجديدة (توافق مع العقد القديم للـ API)' })
  @IsOptional()
  @IsString() @MinLength(8) @MaxLength(200)
  @Matches(/(?=.*[0-9])(?=.*[A-Za-z\u0600-\u06FF])/, { message: 'كلمة المرور يجب أن تتضمن رقمًا وحرفًا' })
  newPassword?: string;
}
