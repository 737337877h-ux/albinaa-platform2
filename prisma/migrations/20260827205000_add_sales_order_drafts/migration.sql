CREATE TABLE "sales_order_drafts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "source_schema" VARCHAR(30) NOT NULL,
  "source_order_no" VARCHAR(30) NOT NULL,
  "source_order_serial" VARCHAR(30) NOT NULL,
  "source_order_date" DATE NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'draft_review',
  "source_customer_code" VARCHAR(30),
  "source_customer_name" VARCHAR(250),
  "source_customer_mobile" VARCHAR(100),
  "source_customer_address" TEXT,
  "proposed_customer_code" VARCHAR(30),
  "proposed_customer_name" VARCHAR(250),
  "currency_code" VARCHAR(10) NOT NULL,
  "source_amount" DECIMAL(38,16) NOT NULL,
  "validation_status" VARCHAR(20) NOT NULL DEFAULT 'blocked',
  "validation_summary" JSONB NOT NULL,
  "notes" TEXT,
  "oracle_write_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_order_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_draft_status_check" CHECK ("status" IN ('draft_review','ready_for_approval','archived','cancelled')),
  CONSTRAINT "sales_order_draft_validation_check" CHECK ("validation_status" IN ('ready','warning','blocked')),
  CONSTRAINT "sales_order_draft_oracle_write_disabled" CHECK ("oracle_write_enabled" = false),
  CONSTRAINT "sales_order_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_drafts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_sales_order_draft_source" ON "sales_order_drafts"("organization_id", "source_schema", "source_order_serial");
CREATE INDEX "idx_sales_order_draft_org_status" ON "sales_order_drafts"("organization_id", "status", "created_at");

CREATE TABLE "sales_order_draft_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "draft_id" UUID NOT NULL,
  "line_no" INTEGER NOT NULL,
  "item_code" VARCHAR(30) NOT NULL,
  "item_name" VARCHAR(250),
  "unit_code" VARCHAR(30) NOT NULL,
  "package_size" DECIMAL(38,16) NOT NULL,
  "quantity" DECIMAL(38,16) NOT NULL,
  "source_price" DECIMAL(38,16) NOT NULL,
  "source_warehouse_code" VARCHAR(30),
  "proposed_warehouse_code" VARCHAR(30),
  "original_available_qty" DECIMAL(38,16),
  "total_available_qty" DECIMAL(38,16) NOT NULL,
  "validation_status" VARCHAR(30) NOT NULL,
  "issues" JSONB NOT NULL,
  "alternative_warehouses" JSONB NOT NULL,
  CONSTRAINT "sales_order_draft_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_draft_line_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "sales_order_draft_lines_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "sales_order_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_sales_order_draft_line" ON "sales_order_draft_lines"("draft_id", "line_no");
CREATE INDEX "idx_sales_order_draft_line_item" ON "sales_order_draft_lines"("item_code", "unit_code");

INSERT INTO "permissions" ("id", "code", "description_ar") VALUES
  (gen_random_uuid(), 'sales_order_drafts.read', 'عرض مسودات طلبات العملاء'),
  (gen_random_uuid(), 'sales_order_drafts.manage', 'إنشاء وتعديل مسودات طلبات العملاء')
ON CONFLICT ("code") DO UPDATE SET "description_ar" = EXCLUDED."description_ar";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role CROSS JOIN "permissions" permission
WHERE role."name" = 'مدير النظام' AND permission."code" LIKE 'sales_order_drafts.%'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
