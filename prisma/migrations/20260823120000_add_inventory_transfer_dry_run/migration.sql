CREATE TABLE "inventory_transfer_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "source_warehouse_code" TEXT NOT NULL,
  "destination_warehouse_code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT,
  "oracle_out_req_ser" TEXT,
  "oracle_transfer_document_number" TEXT,
  "oracle_source_transfer_serial" TEXT,
  "oracle_destination_transfer_serial" TEXT,
  "source_issued" BOOLEAN NOT NULL DEFAULT false,
  "destination_received" BOOLEAN NOT NULL DEFAULT false,
  "transfer_completed" BOOLEAN NOT NULL DEFAULT false,
  "last_oracle_checked_at" TIMESTAMPTZ,
  "last_dry_run_at" TIMESTAMPTZ,
  "last_dry_run_result" JSONB,
  "created_by" UUID NOT NULL,
  "submitted_by" UUID,
  "submitted_at" TIMESTAMPTZ,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMPTZ,
  "review_note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_transfer_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_transfer_source_destination_check" CHECK ("source_warehouse_code" <> "destination_warehouse_code"),
  CONSTRAINT "inventory_transfer_status_check" CHECK ("status" IN ('draft','pending_approval','approved','dry_run_validated','rejected','cancelled')),
  CONSTRAINT "inventory_transfer_tracking_check" CHECK (
    NOT "destination_received" OR "source_issued"
  ),
  CONSTRAINT "inventory_transfer_completion_check" CHECK (
    "transfer_completed" = ("source_issued" AND "destination_received")
  )
);
CREATE UNIQUE INDEX "uq_inventory_transfer_org_idempotency" ON "inventory_transfer_requests"("organization_id", "idempotency_key");
CREATE INDEX "idx_inventory_transfer_org_status" ON "inventory_transfer_requests"("organization_id", "status", "created_at");
ALTER TABLE "inventory_transfer_requests" ADD CONSTRAINT "inventory_transfer_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfer_requests" ADD CONSTRAINT "inventory_transfer_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfer_requests" ADD CONSTRAINT "inventory_transfer_requests_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_transfer_requests" ADD CONSTRAINT "inventory_transfer_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "inventory_transfer_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "line_no" INTEGER NOT NULL,
  "item_code" TEXT NOT NULL,
  "unit_code" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  CONSTRAINT "inventory_transfer_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_transfer_quantity_check" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "uq_inventory_transfer_line_no" ON "inventory_transfer_lines"("request_id", "line_no");
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "inventory_transfer_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "description_ar") VALUES
  (gen_random_uuid(), 'inventory_transfers.read', 'عرض طلبات التحويل المخزني'),
  (gen_random_uuid(), 'inventory_transfers.create', 'إنشاء وإرسال طلبات التحويل المخزني'),
  (gen_random_uuid(), 'inventory_transfers.approve', 'اعتماد أو رفض طلبات التحويل المخزني'),
  (gen_random_uuid(), 'inventory_transfers.dry_run', 'تنفيذ فحص Oracle للقراءة فقط')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'مدير النظام' AND p."code" LIKE 'inventory_transfers.%'
ON CONFLICT DO NOTHING;
