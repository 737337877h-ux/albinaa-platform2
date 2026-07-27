import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ description: '8 أحرف على الأقل وتتضمن رقمًا وحرفًا' })
  @IsString()
  @MinLength(8, { message: 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف' })
  @MaxLength(200)
  @Matches(/(?=.*[0-9])(?=.*[A-Za-z\u0600-\u06FF])/, {
    message: 'كلمة المرور يجب أن تتضمن رقمًا وحرفًا على الأقل',
  })
  newPassword!: string;
}
