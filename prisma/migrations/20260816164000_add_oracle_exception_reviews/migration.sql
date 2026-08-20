CREATE TABLE oracle_movement_exception_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ledger_id UUID NOT NULL REFERENCES oracle_movement_publication_ledger(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  decision VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'recorded',
  reviewed_by UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  notes TEXT NOT NULL,
  review_details JSONB,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_oracle_movement_exception_reviews_ledger UNIQUE (ledger_id),
  CONSTRAINT ck_oracle_movement_exception_reviews_decision CHECK (
    decision IN ('keep_excluded','adopt_oracle_amount','publish_inventory_snapshot_and_retry')
  ),
  CONSTRAINT ck_oracle_movement_exception_reviews_status CHECK (status IN ('recorded','applied','failed')),
  CONSTRAINT ck_oracle_movement_exception_reviews_notes CHECK (char_length(btrim(notes)) BETWEEN 3 AND 500)
);

CREATE INDEX idx_oracle_movement_exception_reviews_org_reviewed
  ON oracle_movement_exception_reviews (organization_id, reviewed_at DESC);
