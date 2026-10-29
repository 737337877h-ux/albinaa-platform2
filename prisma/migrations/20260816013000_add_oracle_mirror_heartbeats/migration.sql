CREATE TABLE IF NOT EXISTS oracle_mirror_heartbeats (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_schema VARCHAR(30) NOT NULL,
  mirror_kind VARCHAR(20) NOT NULL,
  last_checked_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ,
  last_status VARCHAR(20) NOT NULL,
  last_changed BOOLEAN NOT NULL DEFAULT FALSE,
  last_sync_run_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT oracle_mirror_heartbeats_pkey PRIMARY KEY (organization_id, source_schema, mirror_kind),
  CONSTRAINT ck_oracle_mirror_heartbeat_kind CHECK (mirror_kind IN ('customers', 'inventory')),
  CONSTRAINT ck_oracle_mirror_heartbeat_status CHECK (last_status IN ('ok', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_oracle_mirror_heartbeats_checked
  ON oracle_mirror_heartbeats (organization_id, last_checked_at DESC);
