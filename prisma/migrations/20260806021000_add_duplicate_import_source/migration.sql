ALTER TABLE "potential_duplicate_customers"
  ADD COLUMN "source_import_job_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "idx_dup_source_import" ON "potential_duplicate_customers"("source_import_job_id");

ALTER TABLE "potential_duplicate_customers"
  ADD CONSTRAINT "potential_duplicate_customers_source_import_job_id_fkey"
  FOREIGN KEY ("source_import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
