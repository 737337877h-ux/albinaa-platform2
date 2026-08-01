import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateCollectorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'إعادة ربط المحصل بمستخدم آخر (فريد — لا يمكن لمستخدم الارتباط بأكثر من محصل)' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
