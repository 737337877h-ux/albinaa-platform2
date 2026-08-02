import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';

/**
 * Two supported import layouts (CSV export of the source Excel sheets):
 * - debtor:  account number, analytical account, currency, date, doc type, doc no, description, debit, credit
 * - employee: employee no, employee name, account no/name, currency, date, doc type, doc no, description, debit, credit
 */
export const ANALYTICAL_IMPORT_LAYOUTS = ['debtor', 'employee'] as const;

/**
 * The employee layout mixes advance and custody accounts on the same sheet
 * shape, so the category isn't derivable from the columns — it must be
 * selected explicitly per import.
 */
export const EMPLOYEE_IMPORT_CATEGORIES = ['employee_advance', 'employee_custody'] as const;

export class ImportAnalyticalAccountsDto {
  @ApiProperty({ enum: ANALYTICAL_IMPORT_LAYOUTS })
  @IsIn(ANALYTICAL_IMPORT_LAYOUTS)
  layout!: (typeof ANALYTICAL_IMPORT_LAYOUTS)[number];

  @ApiPropertyOptional({
    enum: EMPLOYEE_IMPORT_CATEGORIES,
    description: 'Required when layout is "employee". Selects the category new accounts are created with.',
  })
  @ValidateIf((o: ImportAnalyticalAccountsDto) => o.layout === 'employee')
  @IsIn(EMPLOYEE_IMPORT_CATEGORIES)
  employeeCategory?: (typeof EMPLOYEE_IMPORT_CATEGORIES)[number];
}
