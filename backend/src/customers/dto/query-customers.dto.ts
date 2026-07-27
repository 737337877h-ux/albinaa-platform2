import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class QueryCustomersDto {
  @ApiPropertyOptional({ description: 'بحث: الاسم (بعد التطبيع) أو كود العميل أو الهاتف' })
  @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'تصفية حسب حالة الرصيد', enum: ['debtor', 'creditor', 'zero'] })
  @IsOptional() @IsIn(['debtor', 'creditor', 'zero'])
  balanceState?: 'debtor' | 'creditor' | 'zero';

  @ApiPropertyOptional({ description: 'عملة التصفية/الترتيب بالرصيد (إلزامية مع sortBy=balance)' })
  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'تصفية حسب المنطقة' })
  @IsOptional() @IsString() @MaxLength(200)
  region?: string;

  @ApiPropertyOptional({ description: 'تصفية حسب المحصل الحالي' })
  @IsOptional() @IsUUID()
  collectorId?: string;

  @ApiPropertyOptional({ description: 'تصفية حسب الفرع' })
  @IsOptional() @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive'])
  status?: string;

  @ApiPropertyOptional({ enum: ['name', 'code', 'createdAt', 'balance'], default: 'name' })
  @IsOptional() @IsIn(['name', 'code', 'createdAt', 'balance'])
  sortBy?: 'name' | 'code' | 'createdAt' | 'balance';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional() @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
