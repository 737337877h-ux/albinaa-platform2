import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export const ANALYTICAL_ACCOUNT_CATEGORIES = [
  'debtor',
  'employee_advance',
  'employee_custody',
  'other',
] as const;

export class CreateAnalyticalAccountDto {
  @ApiProperty({ description: 'Account number/code' })
  @IsString() @MaxLength(100)
  accountNumber!: string;

  @ApiProperty({ description: 'Analytical account name' })
  @IsString() @MaxLength(300)
  accountName!: string;

  @ApiProperty({ enum: ANALYTICAL_ACCOUNT_CATEGORIES })
  @IsIn(ANALYTICAL_ACCOUNT_CATEGORIES)
  category!: (typeof ANALYTICAL_ACCOUNT_CATEGORIES)[number];

  @ApiPropertyOptional({ description: 'Person this account belongs to (debtor name, employee name...)' })
  @IsOptional() @IsString() @MaxLength(300)
  personName?: string;

  @ApiPropertyOptional({ description: 'Employee number, for employee_advance/employee_custody accounts' })
  @IsOptional() @IsString() @MaxLength(100)
  employeeNumber?: string;

  @ApiProperty({ description: 'Currency code (e.g. YER)' })
  @IsString() @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ description: 'Free-form extra fields for future account types' })
  @IsOptional() @IsObject()
  metadata?: Record<string, unknown>;
}
