import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class AgingQueryDto {
  @IsOptional()
  @IsDateString()
  asOf?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsIn(['customer', 'advance'])
  accountClass?: 'customer' | 'advance';

  @IsOptional()
  @IsIn(['bucket_0_30', 'bucket_31_60', 'bucket_61_90', 'bucket_91_120', 'bucket_120_plus', 'undated'])
  bucket?: 'bucket_0_30' | 'bucket_31_60' | 'bucket_61_90' | 'bucket_91_120' | 'bucket_120_plus' | 'undated';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  limit?: number;
}
