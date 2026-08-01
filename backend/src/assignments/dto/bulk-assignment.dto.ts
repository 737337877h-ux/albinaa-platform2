import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class BulkAssignmentDto {
  @ApiProperty({
    type: [String],
    description: 'Customer IDs to assign or transfer',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  customerIds!: string[];

  @ApiProperty({
    description: 'Target collector ID',
  })
  @IsUUID()
  collectorId!: string;

  @ApiPropertyOptional({
    description: 'Optional reason for audit log',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
