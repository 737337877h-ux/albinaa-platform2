-- Snapshot row retention keeps run headers for audit and source references.
-- Retired headers must no longer be eligible for full-snapshot publication.
ALTER TABLE "oracle_inventory_sync_runs" DROP CONSTRAINT "ck_oracle_sync_run_status";
ALTER TABLE "oracle_inventory_sync_runs" ADD CONSTRAINT "ck_oracle_sync_run_status"
  CHECK ("status" IN ('extracting','validating','published','rejected','failed','retired'));
ALTER TABLE "oracle_movement_sync_runs" DROP CONSTRAINT "ck_oracle_movement_run_status";
ALTER TABLE "oracle_movement_sync_runs" ADD CONSTRAINT "ck_oracle_movement_run_status"
  CHECK ("status" IN ('extracting','validating','validated','published','rejected','failed','retired'));
