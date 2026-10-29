CREATE TABLE hr_payroll_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES hr_employees(id),
 month text NOT NULL CHECK(month ~ '^2026-(10|11|12)$'), inputs jsonb NOT NULL,calculation jsonb NOT NULL,
 snapshot_hash text NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT hr_payroll_drafts_employee_id_month_key UNIQUE(employee_id,month)
);
INSERT INTO permissions(code,description_ar) VALUES
 ('hr.payroll.read','عرض كشف الموظف ومسودة الراتب'),('hr.payroll.manage','مراجعة وحفظ مسودة الراتب') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='مدير النظام' AND p.code IN ('hr.payroll.read','hr.payroll.manage') ON CONFLICT DO NOTHING;
