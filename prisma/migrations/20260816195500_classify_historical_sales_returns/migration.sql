-- Platform metadata only: historical inbound type-3 inventory movements are sales returns,
-- not ordinary historical rows eligible for exclusion. Oracle remains read-only.
UPDATE oracle_movement_publication_ledger
SET reason_code = 'historical_sales_return_pending_review',
    last_seen_at = CURRENT_TIMESTAMP
WHERE status = 'quarantined'
  AND movement_kind = 'inventory'
  AND reason_code = 'before_publication_cutoff'
  AND details->>'documentType' = '3'
  AND details->>'inOut' = '1';
