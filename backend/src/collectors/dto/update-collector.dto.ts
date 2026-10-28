import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class UpdateCollectorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'رقم المحصل المقابل في IAS20261؛ أرسل null لإلغاء الربط', nullable: true, minimum: 1, maximum: 32767 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32767)
  oracleCollectorNo?: number | null;

  @ApiPropertyOptional({ description: 'إعادة ربط المحصل بمستخدم آخر (فريد — لا يمكن لمستخدم الارتباط بأكثر من محصل)' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
