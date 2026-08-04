import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class GlobalSearchQueryDto {
  @ApiProperty({ minLength: 2, maxLength: 100, description: 'اسم/كود/هاتف، رقم إيصال أو مستند، أو بيانات حجز' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}
