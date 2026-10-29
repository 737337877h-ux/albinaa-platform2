ALTER TABLE hr_employees ADD COLUMN break_start_time text DEFAULT '13:00', ADD COLUMN break_end_time text DEFAULT '14:30';
ALTER TABLE hr_attendance ADD COLUMN break_out timestamptz, ADD COLUMN break_in timestamptz,
 ADD COLUMN break_out_operation_id uuid UNIQUE, ADD COLUMN break_in_operation_id uuid UNIQUE,
 ADD COLUMN break_out_evidence jsonb, ADD COLUMN break_in_evidence jsonb;
CREATE TABLE hr_attendance_displays(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),token_hash text UNIQUE NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz);
CREATE TABLE hr_push_deliveries(id uuid PRIMARY KEY REFERENCES notifications(id),user_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'queued',attempts integer NOT NULL DEFAULT 0,next_attempt timestamptz NOT NULL DEFAULT now(),result jsonb);
CREATE INDEX hr_push_deliveries_status_next_attempt_idx ON hr_push_deliveries(status,next_attempt);
