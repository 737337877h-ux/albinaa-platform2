import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateCreditPolicyDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  allowCreditSale?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  allowPurchaseWithDebt?: boolean;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(3650)
  defaultPaymentDays?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0)
  creditLimitAmount?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(10)
  creditLimitCurrency?: string | null;

  @ApiPropertyOptional({ enum: ['open', 'restricted', 'blocked'] })
  @IsOptional() @IsIn(['open', 'restricted', 'blocked'])
  creditStatus?: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500)
  restrictionReason?: string | null;
}
