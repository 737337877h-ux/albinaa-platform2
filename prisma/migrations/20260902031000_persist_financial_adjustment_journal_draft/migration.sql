ALTER TABLE financial_adjustment_requests
  ADD COLUMN IF NOT EXISTS journal_draft JSONB,
  ADD COLUMN IF NOT EXISTS journal_status TEXT;

CREATE INDEX IF NOT EXISTS idx_financial_adjustment_journal_status
  ON financial_adjustment_requests (organization_id, journal_status)
  WHERE journal_status IS NOT NULL;
