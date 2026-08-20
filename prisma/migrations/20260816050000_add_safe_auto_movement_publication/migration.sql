CREATE TABLE oracle_movement_publication_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_schema VARCHAR(30) NOT NULL,
  source_run_id UUID NOT NULL,
  mode VARCHAR(20) NOT NULL DEFAULT 'automatic',
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  triggered_by UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  counts JSONB,
  error_summary JSONB,
  CONSTRAINT ck_oracle_movement_publication_batch_mode
    CHECK (mode IN ('automatic','manual','baseline')),
  CONSTRAINT ck_oracle_movement_publication_batch_status
    CHECK (status IN ('processing','completed','failed','reversed'))
);

CREATE INDEX idx_oracle_movement_publication_batches_org_started
  ON oracle_movement_publication_batches (organization_id, started_at DESC);

CREATE TABLE oracle_movement_publication_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_schema VARCHAR(30) NOT NULL,
  movement_kind VARCHAR(20) NOT NULL,
  source_fingerprint VARCHAR(64) NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  source_run_id UUID NOT NULL,
  status VARCHAR(30) NOT NULL,
  reason_code VARCHAR(50),
  business_key TEXT,
  publication_batch_id UUID REFERENCES oracle_movement_publication_batches(id) ON UPDATE CASCADE ON DELETE SET NULL,
  platform_entity_id UUID,
  details JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  CONSTRAINT ck_oracle_movement_publication_ledger_kind
    CHECK (movement_kind IN ('customer','inventory')),
  CONSTRAINT ck_oracle_movement_publication_ledger_status
    CHECK (status IN ('baseline_historical','published','ignored_duplicate','quarantined','reversed')),
  CONSTRAINT ck_oracle_movement_publication_ledger_fingerprint
    CHECK (source_fingerprint ~ '^[0-9A-Fa-f]{64}$'),
  CONSTRAINT uq_oracle_movement_publication_ledger_fingerprint
    UNIQUE (organization_id, source_schema, movement_kind, source_fingerprint)
);

CREATE INDEX idx_oracle_movement_publication_ledger_review
  ON oracle_movement_publication_ledger (organization_id, status, movement_kind, last_seen_at DESC);

CREATE INDEX idx_oracle_movement_publication_ledger_batch
  ON oracle_movement_publication_ledger (publication_batch_id);
