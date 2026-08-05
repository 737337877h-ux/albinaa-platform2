import { IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';

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
}
