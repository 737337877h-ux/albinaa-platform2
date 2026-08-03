import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength,
} from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ description: 'Customer this reservation belongs to' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ description: 'Item name/description (e.g. Iron rebar 12mm)' })
  @IsString() @MaxLength(200)
  itemName!: string;

  @ApiPropertyOptional({ description: 'Item type/category' })
  @IsOptional() @IsString() @MaxLength(100)
  itemType?: string;

  @ApiProperty({ description: 'Reserved quantity' })
  @IsNumber() @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ description: 'Normalized unit id. Preferred over legacy unit text.' })
  @IsOptional() @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ description: 'Legacy unit text; resolved to an active normalized unit.' })
  @IsOptional() @IsString() @MaxLength(50)
  unit?: string;

  @ApiProperty({ description: 'Unit price' })
  @IsNumber() @IsPositive()
  unitPrice!: number;

  @ApiProperty({ description: 'Currency code (e.g. YER)' })
  @IsString() @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  warehouse?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  expiresAt?: string;
}
