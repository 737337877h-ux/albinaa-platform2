import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAssignmentDto {
  @ApiProperty() @IsUUID()
  customerId!: string;

  @ApiProperty() @IsUUID()
  collectorId!: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
