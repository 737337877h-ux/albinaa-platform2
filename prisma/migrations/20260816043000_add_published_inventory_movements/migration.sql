CREATE TABLE published_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_schema VARCHAR(30) NOT NULL,
  source_run_id UUID NOT NULL,
  source_fingerprint VARCHAR(64) NOT NULL,
  publication_batch_id UUID NOT NULL,
  external_item_code VARCHAR(30) NOT NULL,
  movement_date DATE NOT NULL,
  document_type VARCHAR(20) NOT NULL,
  document_number VARCHAR(50) NOT NULL,
  document_sequence VARCHAR(50) NOT NULL,
  serial_number VARCHAR(50) NOT NULL,
  unit_name VARCHAR(30) NOT NULL,
  package_size NUMERIC(38,16) NOT NULL,
  item_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  free_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  primary_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  primary_free_quantity NUMERIC(38,16) NOT NULL DEFAULT 0,
  in_out INTEGER NOT NULL,
  external_warehouse_code VARCHAR(30) NOT NULL,
  external_warehouse_group_code VARCHAR(30),
  description TEXT,
  reference_number VARCHAR(100),
  barcode VARCHAR(100),
  published_by UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at TIMESTAMPTZ,
  CONSTRAINT ck_published_inventory_movement_direction CHECK (in_out IN (-1,1)),
  CONSTRAINT ck_published_inventory_movement_fingerprint CHECK (source_fingerprint ~ '^[0-9A-Fa-f]{64}$')
);

CREATE UNIQUE INDEX uq_published_inventory_movements_active_fingerprint
  ON published_inventory_movements (organization_id, source_schema, source_fingerprint)
  WHERE reversed_at IS NULL;

CREATE INDEX idx_published_inventory_movements_item
  ON published_inventory_movements (organization_id, external_item_code, movement_date DESC);

CREATE INDEX idx_published_inventory_movements_warehouse
  ON published_inventory_movements (organization_id, external_warehouse_code, movement_date DESC);
