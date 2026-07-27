import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'كلمة المرور الجديدة (إجراء إداري)' })
  @IsString() @MinLength(8) @MaxLength(200)
  @Matches(/(?=.*[0-9])(?=.*[A-Za-z\u0600-\u06FF])/, { message: 'كلمة المرور يجب أن تتضمن رقمًا وحرفًا' })
  newPassword!: string;
}
