CREATE TABLE oracle_movement_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_schema VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'extracting',
  triggered_by UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  extracted_at TIMESTAMPTZ,
  source_counts JSONB,
  loaded_counts JSONB,
  validation_summary JSONB,
  manifest_hash VARCHAR(64),
  error_summary JSONB,
  CONSTRAINT ck_oracle_movement_run_status CHECK (status IN ('extracting','validating','rejected','failed'))
);

CREATE INDEX idx_oracle_movement_runs_org_started
  ON oracle_movement_sync_runs (organization_id, started_at DESC);

CREATE TABLE oracle_customer_movements_mirror (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id UUID NOT NULL REFERENCES oracle_movement_sync_runs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_fingerprint VARCHAR(64) NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  duplicate_ordinal INTEGER NOT NULL,
  external_customer_code VARCHAR(30) NOT NULL,
  currency_code VARCHAR(10) NOT NULL,
  document_date DATE NOT NULL,
  document_type VARCHAR(20) NOT NULL,
  document_jv_type VARCHAR(20),
  document_number VARCHAR(50),
  document_serial VARCHAR(50),
  record_number VARCHAR(50),
  reference_number VARCHAR(100),
  description TEXT,
  debit_local NUMERIC(38,16) NOT NULL DEFAULT 0,
  credit_local NUMERIC(38,16) NOT NULL DEFAULT 0,
  debit_foreign NUMERIC(38,16) NOT NULL DEFAULT 0,
  credit_foreign NUMERIC(38,16) NOT NULL DEFAULT 0,
  source_created_at TIMESTAMP(0),
  source_updated_at TIMESTAMP(0),
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_oracle_customer_movements_run_fingerprint UNIQUE (sync_run_id, source_fingerprint)
);

CREATE INDEX idx_oracle_customer_movements_lookup
  ON oracle_customer_movements_mirror (sync_run_id, external_customer_code, currency_code, document_date);

CREATE TABLE oracle_inventory_movements_mirror (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id UUID NOT NULL REFERENCES oracle_movement_sync_runs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_fingerprint VARCHAR(64) NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  duplicate_ordinal INTEGER NOT NULL,
  document_type VARCHAR(20) NOT NULL,
  bill_document_type VARCHAR(20),
  document_number VARCHAR(50) NOT NULL,
  document_serial VARCHAR(50) NOT NULL,
  record_number VARCHAR(50),
  document_sequence VARCHAR(50) NOT NULL,
  serial_number VARCHAR(50) NOT NULL,
  movement_date DATE NOT NULL,
  external_item_code VARCHAR(30) NOT NULL,
  unit_name VARCHAR(30) NOT NULL,
  package_size NUMERIC(38,16) NOT NULL,
  item_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  free_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  primary_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  primary_free_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  in_out INTEGER NOT NULL,
  external_warehouse_code VARCHAR(30) NOT NULL,
  external_warehouse_group_code VARCHAR(30),
  item_cost NUMERIC(38,16),
  stock_cost NUMERIC(38,16),
  currency_code VARCHAR(10),
  external_customer_code VARCHAR(30),
  external_vendor_code VARCHAR(30),
  description TEXT,
  reference_number VARCHAR(100),
  barcode VARCHAR(100),
  company_number VARCHAR(20),
  branch_number VARCHAR(20),
  branch_year VARCHAR(20),
  source_created_at TIMESTAMP(0),
  source_updated_at TIMESTAMP(0),
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_oracle_inventory_movements_run_fingerprint UNIQUE (sync_run_id, source_fingerprint)
);

CREATE INDEX idx_oracle_inventory_movements_item
  ON oracle_inventory_movements_mirror (sync_run_id, external_item_code, movement_date);
CREATE INDEX idx_oracle_inventory_movements_warehouse
  ON oracle_inventory_movements_mirror (sync_run_id, external_warehouse_code, movement_date);

ALTER TABLE oracle_mirror_heartbeats DROP CONSTRAINT ck_oracle_mirror_heartbeat_kind;
ALTER TABLE oracle_mirror_heartbeats ADD CONSTRAINT ck_oracle_mirror_heartbeat_kind
  CHECK (mirror_kind IN ('customers', 'inventory', 'movements'));
