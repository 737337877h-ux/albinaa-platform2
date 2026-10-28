CREATE TABLE IF NOT EXISTS barcode_print_jobs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
 operation_id uuid NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dispatching','submitted','failed','unknown')),
 claim uuid, created_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, finished_at timestamptz,
 UNIQUE (organization_id,operation_id)
);
CREATE INDEX IF NOT EXISTS barcode_print_jobs_pending ON barcode_print_jobs(organization_id,status,created_at);
