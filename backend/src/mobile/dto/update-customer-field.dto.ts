import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCustomerFieldDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phonePrimary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phoneSecondary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  whatsapp?: string;

  @IsOptional()
  @IsLatitude()
  geoLat?: number;

  @IsOptional()
  @IsLongitude()
  geoLng?: number;
}
