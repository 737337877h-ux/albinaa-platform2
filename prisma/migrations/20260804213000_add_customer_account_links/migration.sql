-- Non-destructive primary/sub-account relationship.
-- Unlike customer merges, every customer and ledger remains active.
CREATE TABLE "customer_account_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "primary_customer_id" UUID NOT NULL,
  "child_customer_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_account_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_account_links_not_self" CHECK ("primary_customer_id" <> "child_customer_id"),
  CONSTRAINT "customer_account_links_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_account_links_primary_fkey" FOREIGN KEY ("primary_customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_account_links_child_fkey" FOREIGN KEY ("child_customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_customer_account_link_child" ON "customer_account_links"("child_customer_id");
CREATE UNIQUE INDEX "uq_customer_account_link_pair" ON "customer_account_links"("primary_customer_id", "child_customer_id");
CREATE INDEX "idx_customer_account_link_primary" ON "customer_account_links"("organization_id", "primary_customer_id");
