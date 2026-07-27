import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** تعديل وعد مفتوح فقط — الحالة لها مسار مستقل. */
export class UpdatePromiseDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.01)
  expectedAmount?: number;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  expectedMethodId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
