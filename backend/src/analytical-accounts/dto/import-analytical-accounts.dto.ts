import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * Two supported import layouts (CSV export of the source Excel sheets):
 * - debtor:  account number, analytical account, currency, date, doc type, doc no, description, debit, credit
 * - employee: employee no, employee name, account no/name, currency, date, doc type, doc no, description, debit, credit
 */
export const ANALYTICAL_IMPORT_LAYOUTS = ['debtor', 'employee'] as const;

export class ImportAnalyticalAccountsDto {
  @ApiProperty({ enum: ANALYTICAL_IMPORT_LAYOUTS })
  @IsIn(ANALYTICAL_IMPORT_LAYOUTS)
  layout!: (typeof ANALYTICAL_IMPORT_LAYOUTS)[number];
}
