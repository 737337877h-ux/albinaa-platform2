import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReviewReversalRequestDto {
  @ApiProperty() @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(500)
  note?: string;
}
