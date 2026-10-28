import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateSalesOrderDraftLineDto {
  @IsString() @MaxLength(30)
  itemCode!: string;

  @IsOptional() @IsString() @MaxLength(250)
  itemName?: string;

  @IsString() @MaxLength(30)
  unitCode!: string;

  @IsString() @MaxLength(30)
  warehouseCode!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001)
  quantity!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0)
  unitPrice!: number;
}

export class CreateSalesOrderDraftDto {
  @IsOptional() @IsString() @MaxLength(30)
  customerCode?: string;

  @IsOptional() @IsString() @MaxLength(250)
  customerName?: string;

  @IsOptional() @IsIn(['cash', 'credit'])
  orderKind?: 'cash' | 'credit';

  @IsIn(['YR', 'SR', '$'])
  currencyCode!: string;

  @IsDateString()
  orderDate!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateSalesOrderDraftLineDto)
  lines!: CreateSalesOrderDraftLineDto[];
}
