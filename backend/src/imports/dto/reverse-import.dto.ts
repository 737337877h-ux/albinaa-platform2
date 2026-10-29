import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReverseImportDto {
  @ApiProperty({ description: 'سبب التراجع الذي سيظهر في سجل التدقيق' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
