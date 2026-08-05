CREATE TABLE "aging_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "currency_code" TEXT NOT NULL,
  "as_of" DATE NOT NULL,
  "bucket_0_30" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "bucket_31_60" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "bucket_61_90" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "bucket_91_120" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "bucket_120_plus" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "undated" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "total_due" DECIMAL(18,4) NOT NULL,
  "provision_amount" DECIMAL(18,4) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aging_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aging_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "aging_snapshots_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "aging_snapshots_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_aging_snapshot_org_customer_currency_date"
  ON "aging_snapshots"("organization_id", "customer_id", "currency_code", "as_of");
CREATE INDEX "idx_aging_snapshot_report"
  ON "aging_snapshots"("organization_id", "as_of", "currency_code");
