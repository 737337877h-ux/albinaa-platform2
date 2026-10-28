CREATE TABLE hr_employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 employee_no text NOT NULL, full_name text NOT NULL, job_title text NOT NULL,
 manager_no text, active boolean NOT NULL DEFAULT true, work_mode text NOT NULL CHECK (work_mode IN ('office','field','mixed')),
 attendance_exempt boolean NOT NULL DEFAULT false, start_time text, end_time text,
 break_minutes integer NOT NULL DEFAULT 90 CHECK (break_minutes BETWEEN 0 AND 1440),
 work_days integer[] NOT NULL CHECK (cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[0,1,2,3,4,5,6]),
 notes text NOT NULL DEFAULT '', payroll_start date NOT NULL,
 legacy_installments_pending boolean NOT NULL DEFAULT true, account_links jsonb NOT NULL DEFAULT '[]',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT hr_employees_organization_id_employee_no_key UNIQUE(organization_id,employee_no),
 CHECK (attendance_exempt OR (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND start_time IS NOT NULL AND end_time IS NOT NULL))
);
CREATE TABLE hr_salaries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES hr_employees(id),
 effective_from date NOT NULL, base_salary numeric(18,2) NOT NULL CHECK(base_salary>=0),
 fixed_allowance numeric(18,2) CHECK(fixed_allowance>=0), currency text NOT NULL CHECK(currency IN ('YER','SAR','USD')),
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT hr_salaries_employee_id_effective_from_key UNIQUE(employee_id,effective_from)
);
INSERT INTO permissions(code,description_ar) VALUES
 ('hr.read','عرض بيانات الموظفين والدوام'),('hr.manage','إدارة بيانات الموظفين والدوام'),
 ('hr.salary.read','عرض رواتب الموظفين'),('hr.salary.manage','إدارة رواتب الموظفين') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='مدير النظام' AND p.code IN ('hr.read','hr.manage','hr.salary.read','hr.salary.manage')
 ON CONFLICT DO NOTHING;
