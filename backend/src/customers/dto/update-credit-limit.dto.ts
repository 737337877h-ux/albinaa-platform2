import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateCreditLimitDto {
  @ApiProperty() @IsNumber() @Min(0)
  amount!: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'سبب القرار أو تغييره' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
