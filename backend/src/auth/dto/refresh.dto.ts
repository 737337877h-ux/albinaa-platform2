import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'Refresh Token الصادر عند تسجيل الدخول' })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}
