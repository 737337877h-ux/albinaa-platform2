ALTER TABLE hr_employees ADD COLUMN profile jsonb NOT NULL DEFAULT '{}';
ALTER TABLE hr_requests ADD COLUMN monthly_installment numeric(18,2), ADD COLUMN installment_start_month text;
CREATE TABLE hr_employee_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES hr_employees(id), name text NOT NULL, mime text NOT NULL, content bytea NOT NULL, expires_on date, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX hr_employee_documents_employee_id_idx ON hr_employee_documents(employee_id);
CREATE TABLE hr_absence_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES hr_employees(id), work_date date NOT NULL, status text NOT NULL CHECK(status IN ('confirmed','excused')), reason text NOT NULL, reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1, UNIQUE(employee_id,work_date));
