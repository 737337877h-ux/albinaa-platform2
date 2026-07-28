import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class GpsPointDto {
  @ApiProperty({ example: 15.3694 })
  @IsNumber()
  latitude!: number;

  @ApiProperty({ example: 44.1910 })
  @IsNumber()
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  accuracy?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  entityTable?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  entityId?: string;
}
