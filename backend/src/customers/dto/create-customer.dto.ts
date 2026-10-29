import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @ApiProperty({ description: 'كود العميل من النظام المحاسبي — فريد داخل المنشأة' })
  @IsString() @MinLength(1) @MaxLength(50)
  externalCustomerCode!: string;

  @ApiProperty()
  @IsString() @MinLength(2) @MaxLength(300)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  tradeName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30)
  phonePrimary?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30)
  phoneSecondary?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30)
  whatsapp?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  region?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  geoLat?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  geoLng?: number;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  branchId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  customerType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
