ALTER TABLE "customers"
  ADD COLUMN "merged_into_id" UUID,
  ADD COLUMN "merged_at" TIMESTAMPTZ;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_merged_into_id_fkey"
  FOREIGN KEY ("merged_into_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_customers_merged_into" ON "customers"("merged_into_id");

CREATE TABLE "customer_merges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "master_customer_id" UUID NOT NULL,
  "source_customer_id" UUID NOT NULL,
  "pair_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'active',
  "restore_payload" JSONB NOT NULL,
  "merged_by" UUID NOT NULL,
  "merged_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversible_until" TIMESTAMPTZ NOT NULL,
  "reversed_by" UUID,
  "reversed_at" TIMESTAMPTZ,
  CONSTRAINT "customer_merges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_merges_distinct_customers" CHECK ("master_customer_id" <> "source_customer_id"),
  CONSTRAINT "customer_merges_status_check" CHECK ("status" IN ('active', 'reversed')),
  CONSTRAINT "customer_merges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_merges_master_customer_id_fkey" FOREIGN KEY ("master_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_merges_source_customer_id_fkey" FOREIGN KEY ("source_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_merges_merged_by_fkey" FOREIGN KEY ("merged_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_merges_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_customer_merges_active_source"
  ON "customer_merges"("source_customer_id") WHERE "status" = 'active';
CREATE INDEX "idx_customer_merges_org_date" ON "customer_merges"("organization_id", "merged_at");
CREATE INDEX "idx_customer_merges_source_status" ON "customer_merges"("source_customer_id", "status");

CREATE TABLE "customer_aliases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "source_customer_id" UUID,
  "merge_id" UUID,
  "alias_type" TEXT NOT NULL,
  "alias_value" TEXT NOT NULL,
  "alias_normalized" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_aliases_type_check" CHECK ("alias_type" IN ('external_code', 'name', 'phone', 'whatsapp')),
  CONSTRAINT "customer_aliases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_aliases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_aliases_merge_id_fkey" FOREIGN KEY ("merge_id") REFERENCES "customer_merges"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_customer_alias_org_type_value"
  ON "customer_aliases"("organization_id", "alias_type", "alias_normalized");
CREATE INDEX "idx_customer_alias_customer" ON "customer_aliases"("customer_id");
CREATE INDEX "idx_customer_alias_source" ON "customer_aliases"("source_customer_id");

INSERT INTO "permissions" ("id", "code", "description_ar")
VALUES (gen_random_uuid(), 'duplicates.merge', 'دمج العملاء المكررين والتراجع عن الدمج')
ON CONFLICT ("code") DO UPDATE SET "description_ar" = EXCLUDED."description_ar";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'duplicates.merge'
WHERE r."name" IN ('مدير النظام', 'مدير المديونية')
ON CONFLICT DO NOTHING;

ALTER TABLE "operational_ledger" DROP CONSTRAINT "chk_ledger_type";
ALTER TABLE "operational_ledger" ADD CONSTRAINT "chk_ledger_type" CHECK (
  "entry_type" IN (
    'collection', 'collection_reversal', 'manual_adjustment_documented',
    'customer_merge_transfer', 'customer_merge_reversal'
  )
);
