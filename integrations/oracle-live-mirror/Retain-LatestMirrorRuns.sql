BEGIN;

WITH keep AS (
  SELECT id FROM oracle_customer_sync_runs ORDER BY started_at DESC LIMIT 12
), doomed AS (
  SELECT id FROM oracle_customer_sync_runs WHERE id NOT IN (SELECT id FROM keep)
)
DELETE FROM oracle_customer_balances_mirror WHERE sync_run_id IN (SELECT id FROM doomed);

WITH keep AS (
  SELECT id FROM oracle_customer_sync_runs ORDER BY started_at DESC LIMIT 12
), doomed AS (
  SELECT id FROM oracle_customer_sync_runs WHERE id NOT IN (SELECT id FROM keep)
)
DELETE FROM oracle_customer_currencies_mirror WHERE sync_run_id IN (SELECT id FROM doomed);

WITH keep AS (
  SELECT id FROM oracle_customer_sync_runs ORDER BY started_at DESC LIMIT 12
), doomed AS (
  SELECT id FROM oracle_customer_sync_runs WHERE id NOT IN (SELECT id FROM keep)
)
DELETE FROM oracle_customers_mirror WHERE sync_run_id IN (SELECT id FROM doomed);

DELETE FROM oracle_customer_sync_runs
WHERE id NOT IN (SELECT id FROM oracle_customer_sync_runs ORDER BY started_at DESC LIMIT 12);

-- Inventory snapshots and validation evidence are protected as append-only
-- audit records, so retention must not update or delete them here.

COMMIT;
