ALTER TABLE hr_employees ADD COLUMN login_user_id uuid REFERENCES users(id);
CREATE UNIQUE INDEX hr_employees_login_user_id_key ON hr_employees(login_user_id);
CREATE TABLE hr_requests (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES hr_employees(id),submitted_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('advance','leave')),amount numeric(18,2),currency text,
 start_date date,end_date date,leave_type text,reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 decision_reason text,reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='advance' AND amount>0 AND currency IN ('YER','SAR','USD') AND start_date IS NULL AND end_date IS NULL AND leave_type IS NULL)
 OR (kind='leave' AND amount IS NULL AND currency IS NULL AND start_date IS NOT NULL AND end_date>=start_date AND leave_type IN ('annual','sick','unpaid','other')))
);
CREATE INDEX hr_requests_employee_id_created_at_idx ON hr_requests(employee_id,created_at);
INSERT INTO permissions(code,description_ar) VALUES ('hr.requests.review','مراجعة طلبات السلف والإجازات') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='مدير النظام' AND p.code='hr.requests.review' ON CONFLICT DO NOTHING;
