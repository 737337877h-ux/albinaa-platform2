import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ExecuteImportDto {
  @ApiPropertyOptional({
    description: 'تجاوز تحذير "الملف نفسه استورد سابقًا" والتنفيذ رغم ذلك (آمن — لن تتكرر بيانات)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({ description: 'سبب تجاوز قفل فترة محاسبية — يتطلب periods.override' })
  @IsOptional() @IsString() @MaxLength(500)
  accountingOverrideReason?: string;
}
