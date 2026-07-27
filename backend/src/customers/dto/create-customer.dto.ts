import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  branchId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  customerType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
