import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength,
} from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ description: 'Customer this reservation belongs to' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ description: 'إجمالي الحجز بالطن، دون اشتراط صنف عند الإنشاء' })
  @IsNumber() @IsPositive()
  totalTons!: number;

  @ApiPropertyOptional({ description: 'Legacy item description; not required for aggregate ton reservations' })
  @IsOptional() @IsString() @MaxLength(200)
  itemName?: string;

  @ApiPropertyOptional({ description: 'Item type/category' })
  @IsOptional() @IsString() @MaxLength(100)
  itemType?: string;

  @ApiPropertyOptional({ description: 'Legacy reserved quantity' })
  @IsOptional() @IsNumber() @IsPositive()
  quantity?: number;

  @ApiPropertyOptional({ description: 'Normalized unit id. Preferred over legacy unit text.' })
  @IsOptional() @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ description: 'Legacy unit text; resolved to an active normalized unit.' })
  @IsOptional() @IsString() @MaxLength(50)
  unit?: string;

  @ApiProperty({ description: 'سعر الطن الواحد بعملة الحجز' })
  @IsNumber() @IsPositive()
  unitPrice!: number;

  @ApiProperty({ description: 'عملة سعر الحجز', enum: ['YER', 'SAR'] })
  @IsString() @MaxLength(3) @IsIn(['YER', 'SAR'])
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

  @ApiPropertyOptional({ description: 'سبب تجاوز سقف الائتمان، ويتطلب صلاحية credit.override' })
  @IsOptional() @IsString() @MaxLength(500)
  overrideReason?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  expiresAt?: string;
}
