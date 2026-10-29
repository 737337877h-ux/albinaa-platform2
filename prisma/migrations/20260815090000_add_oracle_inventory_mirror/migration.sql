-- Batch A: additive Oracle inventory mirror foundation.
-- This migration creates empty versioned mirror tables only. It does not
-- connect to Oracle, load data, or alter existing business records.

-- CreateTable
CREATE TABLE "oracle_inventory_sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_schema" VARCHAR(30) NOT NULL,
    "mode" VARCHAR(30) NOT NULL DEFAULT 'full_snapshot',
    "status" VARCHAR(20) NOT NULL DEFAULT 'extracting',
    "previous_run_id" UUID,
    "triggered_by" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extracted_at" TIMESTAMPTZ,
    "validated_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "source_counts" JSONB,
    "loaded_counts" JSONB,
    "validation_summary" JSONB,
    "manifest_hash" VARCHAR(64),
    "error_summary" JSONB,

    CONSTRAINT "oracle_inventory_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_inventory_active_snapshots" (
    "organization_id" UUID NOT NULL,
    "source_schema" VARCHAR(30) NOT NULL,
    "active_run_id" UUID NOT NULL,
    "previous_run_id" UUID,
    "activated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_inventory_active_snapshots_pkey" PRIMARY KEY ("organization_id","source_schema")
);

-- CreateTable
CREATE TABLE "oracle_item_groups_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_group_code" VARCHAR(10) NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100),
    "parent_external_code" VARCHAR(30),
    "source_updated_at" TIMESTAMP(0),
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_item_groups_mirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_items_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_item_code" VARCHAR(30) NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "external_group_code" VARCHAR(10) NOT NULL,
    "reference_primary_cost" DECIMAL(38,16),
    "reference_weighted_average_cost" DECIMAL(38,16),
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "is_service" BOOLEAN NOT NULL DEFAULT false,
    "source_updated_at" TIMESTAMP(0),
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_items_mirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_item_units_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_item_code" VARCHAR(30) NOT NULL,
    "unit_name" VARCHAR(10) NOT NULL,
    "package_size" DECIMAL(38,16) NOT NULL,
    "is_main_unit" BOOLEAN NOT NULL DEFAULT false,
    "is_sale_unit" BOOLEAN NOT NULL DEFAULT false,
    "is_purchase_unit" BOOLEAN NOT NULL DEFAULT false,
    "is_stock_unit" BOOLEAN NOT NULL DEFAULT false,
    "is_price_unit" BOOLEAN NOT NULL DEFAULT false,
    "no_sale" BOOLEAN NOT NULL DEFAULT false,
    "barcode" VARCHAR(30),
    "unit_level" INTEGER,
    "uses_serial_number" BOOLEAN NOT NULL DEFAULT false,
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "inactive_reason" VARCHAR(250),
    "source_updated_at" TIMESTAMP(0),
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_item_units_mirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_warehouse_groups_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_group_code" VARCHAR(30) NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100),
    "source_updated_at" TIMESTAMP(0),
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_warehouse_groups_mirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_warehouses_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_warehouse_code" VARCHAR(30) NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100),
    "location_text" VARCHAR(100),
    "phone" VARCHAR(30),
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "keeper_name" VARCHAR(100),
    "external_group_code" VARCHAR(30),
    "warehouse_type" INTEGER,
    "no_sale" BOOLEAN NOT NULL DEFAULT false,
    "check_available_quantity" BOOLEAN NOT NULL DEFAULT false,
    "external_branch_code" VARCHAR(30),
    "main_external_warehouse_code" VARCHAR(30),
    "latitude_raw" VARCHAR(100),
    "longitude_raw" VARCHAR(100),
    "source_updated_at" TIMESTAMP(0),
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_warehouses_mirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_stock_balances_mirror" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_item_code" VARCHAR(30) NOT NULL,
    "unit_name" VARCHAR(10) NOT NULL,
    "package_size" DECIMAL(38,16) NOT NULL,
    "external_warehouse_code" VARCHAR(30) NOT NULL,
    "external_warehouse_group_code" VARCHAR(30),
    "warehouse_group_key" VARCHAR(30) NOT NULL,
    "available_quantity" DECIMAL(38,16) NOT NULL,
    "primary_cost" DECIMAL(38,16),
    "weighted_average_cost" DECIMAL(38,16),
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "source_updated_at" TIMESTAMP(0),
    "source_hash" VARCHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_stock_balances_mirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_branch_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_schema" VARCHAR(30) NOT NULL,
    "external_branch_code" VARCHAR(30) NOT NULL,
    "platform_branch_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_branch_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_sync_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "external_key" VARCHAR(250),
    "rule_code" VARCHAR(80) NOT NULL,
    "message" TEXT NOT NULL,
    "details_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_sync_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_oracle_sync_runs_org_started" ON "oracle_inventory_sync_runs"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_oracle_sync_runs_org_status" ON "oracle_inventory_sync_runs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_oracle_active_snapshots_run" ON "oracle_inventory_active_snapshots"("active_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_item_groups_run_code" ON "oracle_item_groups_mirror"("sync_run_id", "external_group_code");

-- CreateIndex
CREATE INDEX "idx_oracle_items_run_group" ON "oracle_items_mirror"("sync_run_id", "external_group_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_items_run_code" ON "oracle_items_mirror"("sync_run_id", "external_item_code");

-- CreateIndex
CREATE INDEX "idx_oracle_item_units_run_barcode" ON "oracle_item_units_mirror"("sync_run_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_item_units_run_item_unit" ON "oracle_item_units_mirror"("sync_run_id", "external_item_code", "unit_name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_item_units_run_item_size" ON "oracle_item_units_mirror"("sync_run_id", "external_item_code", "package_size");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_wh_groups_run_code" ON "oracle_warehouse_groups_mirror"("sync_run_id", "external_group_code");

-- CreateIndex
CREATE INDEX "idx_oracle_warehouses_run_branch" ON "oracle_warehouses_mirror"("sync_run_id", "external_branch_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_warehouses_run_code" ON "oracle_warehouses_mirror"("sync_run_id", "external_warehouse_code");

-- CreateIndex
CREATE INDEX "idx_oracle_stock_run_wh_item" ON "oracle_stock_balances_mirror"("sync_run_id", "external_warehouse_code", "external_item_code");

-- CreateIndex
CREATE INDEX "idx_oracle_stock_run_item" ON "oracle_stock_balances_mirror"("sync_run_id", "external_item_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_stock_run_key" ON "oracle_stock_balances_mirror"("sync_run_id", "external_item_code", "unit_name", "package_size", "external_warehouse_code", "warehouse_group_key");

-- CreateIndex
CREATE INDEX "idx_oracle_branch_map_platform_active" ON "oracle_branch_mappings"("platform_branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_oracle_branch_map_org_schema_code" ON "oracle_branch_mappings"("organization_id", "source_schema", "external_branch_code");

-- CreateIndex
CREATE INDEX "idx_oracle_sync_issues_run_severity" ON "oracle_sync_issues"("sync_run_id", "severity");

-- CreateIndex
CREATE INDEX "idx_oracle_sync_issues_run_rule" ON "oracle_sync_issues"("sync_run_id", "rule_code");

-- AddForeignKey
ALTER TABLE "oracle_inventory_sync_runs" ADD CONSTRAINT "oracle_inventory_sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_inventory_sync_runs" ADD CONSTRAINT "oracle_inventory_sync_runs_previous_run_id_fkey" FOREIGN KEY ("previous_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_inventory_sync_runs" ADD CONSTRAINT "oracle_inventory_sync_runs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_inventory_active_snapshots" ADD CONSTRAINT "oracle_inventory_active_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_inventory_active_snapshots" ADD CONSTRAINT "oracle_inventory_active_snapshots_active_run_id_fkey" FOREIGN KEY ("active_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_inventory_active_snapshots" ADD CONSTRAINT "oracle_inventory_active_snapshots_previous_run_id_fkey" FOREIGN KEY ("previous_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_item_groups_mirror" ADD CONSTRAINT "oracle_item_groups_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_item_groups_mirror" ADD CONSTRAINT "oracle_item_groups_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_items_mirror" ADD CONSTRAINT "oracle_items_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_items_mirror" ADD CONSTRAINT "oracle_items_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_items_mirror" ADD CONSTRAINT "oracle_items_mirror_sync_run_id_external_group_code_fkey" FOREIGN KEY ("sync_run_id", "external_group_code") REFERENCES "oracle_item_groups_mirror"("sync_run_id", "external_group_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_item_units_mirror" ADD CONSTRAINT "oracle_item_units_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_item_units_mirror" ADD CONSTRAINT "oracle_item_units_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_item_units_mirror" ADD CONSTRAINT "oracle_item_units_mirror_sync_run_id_external_item_code_fkey" FOREIGN KEY ("sync_run_id", "external_item_code") REFERENCES "oracle_items_mirror"("sync_run_id", "external_item_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_warehouse_groups_mirror" ADD CONSTRAINT "oracle_warehouse_groups_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_warehouse_groups_mirror" ADD CONSTRAINT "oracle_warehouse_groups_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_warehouses_mirror" ADD CONSTRAINT "oracle_warehouses_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_warehouses_mirror" ADD CONSTRAINT "oracle_warehouses_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_warehouses_mirror" ADD CONSTRAINT "oracle_warehouses_mirror_sync_run_id_external_group_code_fkey" FOREIGN KEY ("sync_run_id", "external_group_code") REFERENCES "oracle_warehouse_groups_mirror"("sync_run_id", "external_group_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_warehouses_mirror" ADD CONSTRAINT "oracle_warehouses_mirror_sync_run_id_main_external_warehou_fkey" FOREIGN KEY ("sync_run_id", "main_external_warehouse_code") REFERENCES "oracle_warehouses_mirror"("sync_run_id", "external_warehouse_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_stock_balances_mirror" ADD CONSTRAINT "oracle_stock_balances_mirror_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_stock_balances_mirror" ADD CONSTRAINT "oracle_stock_balances_mirror_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_stock_balances_mirror" ADD CONSTRAINT "oracle_stock_balances_mirror_sync_run_id_external_item_cod_fkey" FOREIGN KEY ("sync_run_id", "external_item_code", "unit_name") REFERENCES "oracle_item_units_mirror"("sync_run_id", "external_item_code", "unit_name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_stock_balances_mirror" ADD CONSTRAINT "fk_oracle_stock_warehouse" FOREIGN KEY ("sync_run_id", "external_warehouse_code") REFERENCES "oracle_warehouses_mirror"("sync_run_id", "external_warehouse_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_stock_balances_mirror" ADD CONSTRAINT "fk_oracle_stock_warehouse_group" FOREIGN KEY ("sync_run_id", "external_warehouse_group_code") REFERENCES "oracle_warehouse_groups_mirror"("sync_run_id", "external_group_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_branch_mappings" ADD CONSTRAINT "oracle_branch_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_branch_mappings" ADD CONSTRAINT "oracle_branch_mappings_platform_branch_id_fkey" FOREIGN KEY ("platform_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_branch_mappings" ADD CONSTRAINT "oracle_branch_mappings_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_sync_issues" ADD CONSTRAINT "oracle_sync_issues_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "oracle_inventory_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_sync_issues" ADD CONSTRAINT "oracle_sync_issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks that Prisma cannot express directly.
ALTER TABLE "oracle_inventory_sync_runs"
  ADD CONSTRAINT "ck_oracle_sync_run_mode"
  CHECK ("mode" IN ('full_snapshot', 'incremental')),
  ADD CONSTRAINT "ck_oracle_sync_run_status"
  CHECK ("status" IN ('extracting', 'validating', 'published', 'rejected', 'failed')),
  ADD CONSTRAINT "ck_oracle_sync_run_manifest_hash"
  CHECK ("manifest_hash" IS NULL OR "manifest_hash" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "ck_oracle_sync_run_published_times"
  CHECK ("status" <> 'published' OR ("validated_at" IS NOT NULL AND "published_at" IS NOT NULL));

ALTER TABLE "oracle_item_groups_mirror"
  ADD CONSTRAINT "ck_oracle_item_group_code_nonblank" CHECK (BTRIM("external_group_code") <> ''),
  ADD CONSTRAINT "ck_oracle_item_group_hash" CHECK ("source_hash" ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE "oracle_items_mirror"
  ADD CONSTRAINT "ck_oracle_item_code_nonblank" CHECK (BTRIM("external_item_code") <> ''),
  ADD CONSTRAINT "ck_oracle_item_name_nonblank" CHECK (BTRIM("name_ar") <> ''),
  ADD CONSTRAINT "ck_oracle_item_hash" CHECK ("source_hash" ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE "oracle_item_units_mirror"
  ADD CONSTRAINT "ck_oracle_item_unit_name_nonblank" CHECK (BTRIM("unit_name") <> ''),
  ADD CONSTRAINT "ck_oracle_item_unit_package_size" CHECK ("package_size" > 0),
  ADD CONSTRAINT "ck_oracle_item_unit_barcode_nonblank" CHECK ("barcode" IS NULL OR BTRIM("barcode") <> ''),
  ADD CONSTRAINT "ck_oracle_item_unit_hash" CHECK ("source_hash" ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE "oracle_warehouse_groups_mirror"
  ADD CONSTRAINT "ck_oracle_wh_group_code_nonblank" CHECK (BTRIM("external_group_code") <> ''),
  ADD CONSTRAINT "ck_oracle_wh_group_hash" CHECK ("source_hash" ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE "oracle_warehouses_mirror"
  ADD CONSTRAINT "ck_oracle_warehouse_code_nonblank" CHECK (BTRIM("external_warehouse_code") <> ''),
  ADD CONSTRAINT "ck_oracle_warehouse_name_nonblank" CHECK (BTRIM("name_ar") <> ''),
  ADD CONSTRAINT "ck_oracle_warehouse_hash" CHECK ("source_hash" ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE "oracle_stock_balances_mirror"
  ADD CONSTRAINT "ck_oracle_stock_package_size" CHECK ("package_size" > 0),
  ADD CONSTRAINT "ck_oracle_stock_group_key"
    CHECK ("warehouse_group_key" = COALESCE(NULLIF(BTRIM("external_warehouse_group_code"), ''), '#NULL')),
  ADD CONSTRAINT "ck_oracle_stock_hash" CHECK ("source_hash" ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE "oracle_branch_mappings"
  ADD CONSTRAINT "ck_oracle_branch_map_schema_nonblank" CHECK (BTRIM("source_schema") <> ''),
  ADD CONSTRAINT "ck_oracle_branch_map_code_nonblank" CHECK (BTRIM("external_branch_code") <> '');

ALTER TABLE "oracle_sync_issues"
  ADD CONSTRAINT "ck_oracle_sync_issue_severity" CHECK ("severity" IN ('info', 'warning', 'error')),
  ADD CONSTRAINT "ck_oracle_sync_issue_rule_nonblank" CHECK (BTRIM("rule_code") <> '');

-- Oracle barcodes are optional, but every non-null barcode must be unique in
-- the same snapshot. The ordinary lookup index generated by Prisma remains.
CREATE UNIQUE INDEX "uq_oracle_item_units_run_barcode_nonnull"
  ON "oracle_item_units_mirror" ("sync_run_id", "barcode")
  WHERE "barcode" IS NOT NULL;

-- Ensure every mirrored row belongs to the same organization as its run.
CREATE OR REPLACE FUNCTION "enforce_oracle_inventory_run_scope"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "oracle_inventory_sync_runs" r
    WHERE r."id" = NEW."sync_run_id"
      AND r."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'Oracle mirror organization does not match sync run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_oracle_item_groups_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_item_groups_mirror"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_inventory_run_scope"();
CREATE TRIGGER "trg_oracle_items_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_items_mirror"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_inventory_run_scope"();
CREATE TRIGGER "trg_oracle_item_units_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_item_units_mirror"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_inventory_run_scope"();
CREATE TRIGGER "trg_oracle_wh_groups_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_warehouse_groups_mirror"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_inventory_run_scope"();
CREATE TRIGGER "trg_oracle_warehouses_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_warehouses_mirror"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_inventory_run_scope"();
CREATE TRIGGER "trg_oracle_stock_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_stock_balances_mirror"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_inventory_run_scope"();
CREATE TRIGGER "trg_oracle_sync_issues_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_sync_issues"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_inventory_run_scope"();

-- A run can only point to a predecessor and triggering user in its own scope.
CREATE OR REPLACE FUNCTION "enforce_oracle_sync_run_scope"()
RETURNS trigger AS $$
BEGIN
  IF NEW."previous_run_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "oracle_inventory_sync_runs" p
    WHERE p."id" = NEW."previous_run_id"
      AND p."organization_id" = NEW."organization_id"
      AND p."source_schema" = NEW."source_schema"
  ) THEN
    RAISE EXCEPTION 'Previous Oracle sync run belongs to another scope';
  END IF;

  IF NEW."triggered_by" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "users" u
    WHERE u."id" = NEW."triggered_by"
      AND u."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'Oracle sync trigger user belongs to another organization';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_oracle_sync_run_scope"
  BEFORE INSERT OR UPDATE ON "oracle_inventory_sync_runs"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_sync_run_scope"();

-- Branch mappings may only reference a platform branch and verifier from the
-- same organization.
CREATE OR REPLACE FUNCTION "enforce_oracle_branch_mapping_scope"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "branches" b
    WHERE b."id" = NEW."platform_branch_id"
      AND b."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'Oracle branch mapping targets another organization';
  END IF;

  IF NEW."verified_by" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "users" u
    WHERE u."id" = NEW."verified_by"
      AND u."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'Oracle branch verifier belongs to another organization';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_oracle_branch_mapping_scope"
  BEFORE INSERT OR UPDATE ON "oracle_branch_mappings"
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_branch_mapping_scope"();

-- The active pointer is switched only to a published run in the same source
-- and organization. The deferred trigger supports publishing and switching
-- inside one transaction.
CREATE OR REPLACE FUNCTION "enforce_oracle_active_snapshot"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "oracle_inventory_sync_runs" r
    WHERE r."id" = NEW."active_run_id"
      AND r."organization_id" = NEW."organization_id"
      AND r."source_schema" = NEW."source_schema"
      AND r."status" = 'published'
  ) THEN
    RAISE EXCEPTION 'Active Oracle snapshot must reference a published run in the same scope';
  END IF;

  IF NEW."previous_run_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "oracle_inventory_sync_runs" p
    WHERE p."id" = NEW."previous_run_id"
      AND p."organization_id" = NEW."organization_id"
      AND p."source_schema" = NEW."source_schema"
      AND p."status" = 'published'
  ) THEN
    RAISE EXCEPTION 'Previous Oracle snapshot must reference a published run in the same scope';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "trg_oracle_active_snapshot_valid"
  AFTER INSERT OR UPDATE ON "oracle_inventory_active_snapshots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "enforce_oracle_active_snapshot"();

-- Snapshot data and validation issues are append-only. The existing project
-- function forbid_mutation() raises on UPDATE or DELETE.
CREATE TRIGGER "trg_oracle_item_groups_immutable"
  BEFORE UPDATE OR DELETE ON "oracle_item_groups_mirror"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "trg_oracle_items_immutable"
  BEFORE UPDATE OR DELETE ON "oracle_items_mirror"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "trg_oracle_item_units_immutable"
  BEFORE UPDATE OR DELETE ON "oracle_item_units_mirror"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "trg_oracle_wh_groups_immutable"
  BEFORE UPDATE OR DELETE ON "oracle_warehouse_groups_mirror"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "trg_oracle_warehouses_immutable"
  BEFORE UPDATE OR DELETE ON "oracle_warehouses_mirror"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "trg_oracle_stock_immutable"
  BEFORE UPDATE OR DELETE ON "oracle_stock_balances_mirror"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "trg_oracle_sync_issues_immutable"
  BEFORE UPDATE OR DELETE ON "oracle_sync_issues"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- Read-only current-snapshot views. Their joins make them non-updatable and
-- keep failed or unvalidated runs invisible to application queries.
CREATE VIEW "current_oracle_item_groups" AS
SELECT m.*
FROM "oracle_item_groups_mirror" m
JOIN "oracle_inventory_active_snapshots" a
  ON a."organization_id" = m."organization_id"
 AND a."active_run_id" = m."sync_run_id";

CREATE VIEW "current_oracle_items" AS
SELECT m.*
FROM "oracle_items_mirror" m
JOIN "oracle_inventory_active_snapshots" a
  ON a."organization_id" = m."organization_id"
 AND a."active_run_id" = m."sync_run_id";

CREATE VIEW "current_oracle_item_units" AS
SELECT m.*
FROM "oracle_item_units_mirror" m
JOIN "oracle_inventory_active_snapshots" a
  ON a."organization_id" = m."organization_id"
 AND a."active_run_id" = m."sync_run_id";

CREATE VIEW "current_oracle_warehouse_groups" AS
SELECT m.*
FROM "oracle_warehouse_groups_mirror" m
JOIN "oracle_inventory_active_snapshots" a
  ON a."organization_id" = m."organization_id"
 AND a."active_run_id" = m."sync_run_id";

CREATE VIEW "current_oracle_warehouses" AS
SELECT m.*
FROM "oracle_warehouses_mirror" m
JOIN "oracle_inventory_active_snapshots" a
  ON a."organization_id" = m."organization_id"
 AND a."active_run_id" = m."sync_run_id";

CREATE VIEW "current_oracle_stock_balances" AS
SELECT m.*
FROM "oracle_stock_balances_mirror" m
JOIN "oracle_inventory_active_snapshots" a
  ON a."organization_id" = m."organization_id"
 AND a."active_run_id" = m."sync_run_id";
