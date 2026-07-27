import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  username!: string;

  @ApiProperty({ example: 'ChangeMe!2026' })
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password!: string;
}
