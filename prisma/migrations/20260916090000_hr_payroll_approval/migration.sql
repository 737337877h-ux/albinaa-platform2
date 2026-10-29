CREATE TABLE hr_payroll_approvals (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 month text NOT NULL CHECK(month ~ '^2026-(10|11|12)$'), revision integer NOT NULL CHECK(revision>0),
 status text NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','reopened')),
 snapshot jsonb NOT NULL, review_hash text NOT NULL, reason text NOT NULL,
 approved_by uuid NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL DEFAULT now(),
 reopened_by uuid REFERENCES users(id), reopened_at timestamptz, reopen_reason text,
 reopen_operation_id uuid UNIQUE, version integer NOT NULL DEFAULT 1,
 UNIQUE(organization_id,month,revision),
 CHECK(status<>'reopened' OR (reopened_by IS NOT NULL AND reopened_at IS NOT NULL AND length(trim(reopen_reason))>=3))
);
CREATE INDEX hr_payroll_approvals_organization_id_month_status_idx ON hr_payroll_approvals(organization_id,month,status);
CREATE UNIQUE INDEX hr_payroll_one_active_approval ON hr_payroll_approvals(organization_id,month) WHERE status='approved';
INSERT INTO permissions(code,description_ar) VALUES('hr.payroll.approve','اعتماد وإعادة فتح كشف الرواتب بعد إغلاق الشهر') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='مدير النظام' AND p.code='hr.payroll.approve' ON CONFLICT DO NOTHING;
