import { IsIn, IsString, Length } from 'class-validator';

export const ORACLE_EXCEPTION_DECISIONS = [
  'keep_excluded',
  'adopt_oracle_amount',
  'publish_inventory_snapshot_and_retry',
  'publish_verified_historical_collection',
  'reassign_historical_invoice',
] as const;

export type OracleExceptionDecision = typeof ORACLE_EXCEPTION_DECISIONS[number];

export class ReviewOracleExceptionDto {
  @IsIn(ORACLE_EXCEPTION_DECISIONS)
  decision!: OracleExceptionDecision;

  @IsString()
  @Length(3, 500)
  notes!: string;
}
