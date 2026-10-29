-- Batch F: additive Oracle customer and balance mirror.
-- These tables are isolated from operational customers and balances. A load
-- stops at status "validating" and has no publication pointer.

CREATE TABLE "oracle_customer_sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_schema" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'extracting',
    "triggered_by" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extracted_at" TIMESTAMPTZ,
    "validated_at" TIMESTAMPTZ,
    "source_counts" JSONB,
    "loaded_counts" JSONB,
    "validation_summary" JSONB,
    "platform_comparison" JSONB,
    "manifest_hash" VARCHAR(64),
    "error_summary" JSONB,
    CONSTRAINT "oracle_customer_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oracle_customers_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_customer_code" VARCHAR(30) NOT NULL,
    "account_number" VARCHAR(30),
    "name_ar" VARCHAR(250) NOT NULL,
    "phone" VARCHAR(100),
    "mobile" VARCHAR(100),
    "address" TEXT,
    "external_region_code" VARCHAR(30),
    "latitude_raw" VARCHAR(100),
    "longitude_raw" VARCHAR(100),
    "relationship_start_date" DATE,
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "external_branch_code" VARCHAR(30),
    "external_collector_code" VARCHAR(30),
    "source_created_at" TIMESTAMP(0),
    "source_updated_at" TIMESTAMP(0),
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oracle_customers_mirror_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oracle_customer_currencies_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_customer_code" VARCHAR(30) NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL,
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "credit_limit" DECIMAL(38,16) NOT NULL DEFAULT 0,
    "invoice_limit" DECIMAL(38,16) NOT NULL DEFAULT 0,
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oracle_customer_currencies_mirror_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oracle_customer_balances_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_customer_code" VARCHAR(30) NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL,
    "transaction_count" INTEGER NOT NULL,
    "opening_debit_local" DECIMAL(38,16) NOT NULL,
    "opening_credit_local" DECIMAL(38,16) NOT NULL,
    "balance_local" DECIMAL(38,16) NOT NULL,
    "opening_debit_foreign" DECIMAL(38,16) NOT NULL,
    "opening_credit_foreign" DECIMAL(38,16) NOT NULL,
    "balance_foreign" DECIMAL(38,16) NOT NULL,
    "first_transaction_date" DATE,
    "last_transaction_date" DATE,
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oracle_customer_balances_mirror_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_oracle_cust_runs_org_started" ON "oracle_customer_sync_runs"("organization_id", "started_at");
CREATE INDEX "idx_oracle_cust_runs_org_status" ON "oracle_customer_sync_runs"("organization_id", "status");
CREATE UNIQUE INDEX "uq_oracle_customers_run_code" ON "oracle_customers_mirror"("sync_run_id", "external_customer_code");
CREATE INDEX "idx_oracle_customers_org_code" ON "oracle_customers_mirror"("organization_id", "external_customer_code");
CREATE UNIQUE INDEX "uq_oracle_cust_curr_run_key" ON "oracle_customer_currencies_mirror"("sync_run_id", "external_customer_code", "currency_code");
CREATE INDEX "idx_oracle_cust_curr_run_currency" ON "oracle_customer_currencies_mirror"("sync_run_id", "currency_code");
CREATE UNIQUE INDEX "uq_oracle_cust_balance_run_key" ON "oracle_customer_balances_mirror"("sync_run_id", "external_customer_code", "currency_code");
CREATE INDEX "idx_oracle_cust_balance_run_currency" ON "oracle_customer_balances_mirror"("sync_run_id", "currency_code");

ALTER TABLE "oracle_customer_sync_runs" ADD CONSTRAINT "oracle_customer_sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customer_sync_runs" ADD CONSTRAINT "oracle_customer_sync_runs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oracle_customers_mirror" ADD CONSTRAINT "oracle_customers_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_customer_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customers_mirror" ADD CONSTRAINT "oracle_customers_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customer_currencies_mirror" ADD CONSTRAINT "oracle_customer_currencies_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_customer_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customer_currencies_mirror" ADD CONSTRAINT "oracle_customer_currencies_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customer_currencies_mirror" ADD CONSTRAINT "oracle_customer_currencies_mirror_customer_fkey" FOREIGN KEY ("sync_run_id", "external_customer_code") REFERENCES "oracle_customers_mirror"("sync_run_id", "external_customer_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customer_balances_mirror" ADD CONSTRAINT "oracle_customer_balances_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_customer_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customer_balances_mirror" ADD CONSTRAINT "oracle_customer_balances_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_customer_balances_mirror" ADD CONSTRAINT "oracle_customer_balances_mirror_customer_fkey" FOREIGN KEY ("sync_run_id", "external_customer_code") REFERENCES "oracle_customers_mirror"("sync_run_id", "external_customer_code") ON DELETE RESTRICT ON UPDATE CASCADE;
