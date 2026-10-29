ALTER TABLE "import_jobs"
  ADD COLUMN "rollback_state" JSONB,
  ADD COLUMN "reversed_by" UUID,
  ADD COLUMN "reversed_at" TIMESTAMPTZ,
  ADD COLUMN "reversal_reason" TEXT;

ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_reversed_by_fkey"
  FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_jobs" DROP CONSTRAINT "chk_import_status";
ALTER TABLE "import_jobs" ADD CONSTRAINT "chk_import_status"
  CHECK ("status" IN ('dry_run', 'running', 'completed', 'failed', 'reversed'));

ALTER TABLE "imported_transactions" ADD COLUMN "reversed_at" TIMESTAMPTZ;
ALTER TABLE "balance_snapshots" ADD COLUMN "reversed_at" TIMESTAMPTZ;
ALTER TABLE "balance_reconciliations" ADD COLUMN "reversed_at" TIMESTAMPTZ;
ALTER TABLE "debt_aging_summary" ADD COLUMN "reversed_at" TIMESTAMPTZ;
ALTER TABLE "debt_aging_details" ADD COLUMN "reversed_at" TIMESTAMPTZ;
ALTER TABLE "analytical_movements" ADD COLUMN "reversed_at" TIMESTAMPTZ;

ALTER TABLE "imported_transactions" DROP CONSTRAINT IF EXISTS "imported_transactions_line_hash_key";
ALTER TABLE "debt_aging_summary" DROP CONSTRAINT IF EXISTS "debt_aging_summary_line_hash_key";
ALTER TABLE "debt_aging_details" DROP CONSTRAINT IF EXISTS "debt_aging_details_line_hash_key";
ALTER TABLE "analytical_movements" DROP CONSTRAINT IF EXISTS "analytical_movements_line_hash_key";

CREATE UNIQUE INDEX "uq_imported_transactions_active_line_hash"
  ON "imported_transactions" ("line_hash") WHERE "reversed_at" IS NULL;
CREATE UNIQUE INDEX "uq_debt_aging_summary_active_line_hash"
  ON "debt_aging_summary" ("line_hash") WHERE "reversed_at" IS NULL;
CREATE UNIQUE INDEX "uq_debt_aging_details_active_line_hash"
  ON "debt_aging_details" ("line_hash") WHERE "reversed_at" IS NULL;
CREATE UNIQUE INDEX "uq_analytical_movements_active_line_hash"
  ON "analytical_movements" ("line_hash") WHERE "reversed_at" IS NULL;

CREATE INDEX "idx_import_jobs_reversed_at" ON "import_jobs" ("organization_id", "reversed_at");
