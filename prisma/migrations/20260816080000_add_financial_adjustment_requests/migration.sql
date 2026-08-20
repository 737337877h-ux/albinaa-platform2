CREATE TABLE "financial_adjustment_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "request_type" TEXT NOT NULL,
  "currency_code" TEXT NOT NULL,
  "requested_amount" DECIMAL(18,4) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewed_by" UUID,
  "review_notes" TEXT,
  "reviewed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_adjustment_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_adjustment_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
  CONSTRAINT "financial_adjustment_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
  CONSTRAINT "financial_adjustment_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id"),
  CONSTRAINT "financial_adjustment_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id"),
  CONSTRAINT "financial_adjustment_request_type_check" CHECK ("request_type" IN ('discount','settlement')),
  CONSTRAINT "financial_adjustment_request_status_check" CHECK ("status" IN ('pending','approved','rejected')),
  CONSTRAINT "financial_adjustment_request_amount_check" CHECK ("requested_amount" > 0)
);

CREATE INDEX "idx_financial_adjustment_requests_status" ON "financial_adjustment_requests"("organization_id", "status", "created_at");
CREATE INDEX "idx_financial_adjustment_requests_customer" ON "financial_adjustment_requests"("customer_id", "status");
CREATE UNIQUE INDEX "uq_financial_adjustment_request_pending" ON "financial_adjustment_requests"("customer_id", "request_type") WHERE "status" = 'pending';
