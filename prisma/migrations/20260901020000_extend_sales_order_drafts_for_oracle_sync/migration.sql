ALTER TABLE "sales_order_drafts"
  ADD COLUMN "bill_document_type" VARCHAR(10),
  ADD COLUMN "order_kind" VARCHAR(10) NOT NULL DEFAULT 'other',
  ADD COLUMN "customer_binding_status" VARCHAR(30) NOT NULL DEFAULT 'not_checked',
  ADD COLUMN "source_approved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source_processed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source_updated_at" TIMESTAMPTZ,
  ADD COLUMN "synced_at" TIMESTAMPTZ;

ALTER TABLE "sales_order_drafts"
  ADD CONSTRAINT "sales_order_draft_kind_check"
  CHECK ("order_kind" IN ('cash','credit','other'));

CREATE INDEX "idx_sales_order_draft_kind_date"
  ON "sales_order_drafts"("organization_id", "order_kind", "source_order_date");

CREATE INDEX "idx_sales_order_draft_customer_binding"
  ON "sales_order_drafts"("organization_id", "customer_binding_status", "source_order_date");
