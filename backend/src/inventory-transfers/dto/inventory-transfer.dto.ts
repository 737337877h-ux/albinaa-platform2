import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength,
  Min, ValidateNested,
} from 'class-validator';

export class InventoryTransferLineDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  itemCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(40)
  unitCode!: string;

  @Type(() => Number) @Min(0.0001)
  quantity!: number;
}

export class CreateInventoryTransferDto {
  @IsString() @IsNotEmpty() @MaxLength(160)
  idempotencyKey!: string;

  @IsString() @IsNotEmpty() @MaxLength(80)
  sourceWarehouseCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(80)
  destinationWarehouseCode!: string;

  @IsOptional() @IsString() @MaxLength(30)
  oracleSourceTransferSerial?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InventoryTransferLineDto)
  lines!: InventoryTransferLineDto[];
}

export class ReviewInventoryTransferDto {
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}
