import { IsIn, IsOptional, Matches } from 'class-validator';

export class CompletePromiseDto {
  @IsOptional() @Matches(/^[a-f0-9]{64}$/)
  expectedPlanHash?: string;

  @IsOptional() @IsIn(['receipts', 'account_settlement'])
  mode?: 'receipts' | 'account_settlement';
}
