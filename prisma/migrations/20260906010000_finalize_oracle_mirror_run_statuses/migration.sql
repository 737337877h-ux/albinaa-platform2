-- Give the monitoring screen an explicit lifecycle after validation and
-- controlled platform publication. Oracle remains read-only.

ALTER TABLE "oracle_customer_sync_runs"
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ;

ALTER TABLE "oracle_movement_sync_runs"
  ADD COLUMN IF NOT EXISTS "validated_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ;

ALTER TABLE "oracle_movement_sync_runs"
  DROP CONSTRAINT IF EXISTS "ck_oracle_movement_run_status";

ALTER TABLE "oracle_movement_sync_runs"
  ADD CONSTRAINT "ck_oracle_movement_run_status"
  CHECK ("status" IN ('extracting','validating','validated','published','rejected','failed'));

UPDATE "oracle_customer_sync_runs"
SET "status" = 'validated',
    "validated_at" = COALESCE("validated_at", "started_at")
WHERE "status" = 'validating'
  AND COALESCE(("validation_summary"->>'passed')::boolean, false);

UPDATE "oracle_movement_sync_runs"
SET "status" = 'validated',
    "validated_at" = COALESCE("validated_at", "started_at")
WHERE "status" = 'validating';
