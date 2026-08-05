import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class UpdateCurrencyDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  sourceCode?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  nameAr?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  decimals?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @IsPositive()
  exchangeRate?: number;
}
