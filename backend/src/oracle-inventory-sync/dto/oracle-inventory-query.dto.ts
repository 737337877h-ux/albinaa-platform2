import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function parseBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export const ORACLE_INVENTORY_DECISION_TYPES = [
  'negative_stock', 'stockout_risk', 'reorder', 'dead_stock',
  'slow_moving', 'overstock', 'seasonal_candidate', 'fast_moving',
  'insufficient_history',
] as const;

export class OracleInventorySourceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  sourceSchema?: string;

  @IsOptional()
  @IsIn(ORACLE_INVENTORY_DECISION_TYPES)
  decisionType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  decisionPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  decisionLimit?: number;
}

export class OracleInventoryListQueryDto extends OracleInventorySourceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class OracleInventoryItemsQueryDto extends OracleInventoryListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  groupCode?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}

export class OracleInventoryWarehousesQueryDto extends OracleInventorySourceQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}

export class OracleInventoryStockQueryDto extends OracleInventoryListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  itemCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  warehouseCode?: string;

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  positiveOnly?: boolean;
}
