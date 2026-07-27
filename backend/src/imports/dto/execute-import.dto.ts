import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ExecuteImportDto {
  @ApiPropertyOptional({
    description: 'تجاوز تحذير "الملف نفسه استورد سابقًا" والتنفيذ رغم ذلك (آمن — لن تتكرر بيانات)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
