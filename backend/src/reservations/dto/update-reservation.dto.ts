import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

// Operational fields only — quantity/price/currency are not editable after
// creation to keep the reservation's totals and issuing math unambiguous.
export class UpdateReservationDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  warehouse?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  expiresAt?: string;
}
