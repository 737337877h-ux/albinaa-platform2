import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateUnitDto {
  @IsString()
  @MaxLength(30)
  code!: string;

  @IsString()
  @MaxLength(100)
  nameAr!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  weightKg?: number | null;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  weightKg?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
