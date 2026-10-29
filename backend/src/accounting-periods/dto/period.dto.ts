import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class LockAccountingPeriodDto {
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2200)
  year!: number;

  @ApiProperty({ example: 7 }) @IsInt() @Min(1) @Max(12)
  month!: number;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class UnlockAccountingPeriodDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

