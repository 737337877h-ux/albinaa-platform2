CREATE TABLE accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'open')),
  reason TEXT NOT NULL,
  locked_by UUID NOT NULL REFERENCES users(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlocked_by UUID REFERENCES users(id),
  unlocked_at TIMESTAMPTZ,
  unlock_reason TEXT,
  CONSTRAINT uq_accounting_period_org_month UNIQUE (organization_id, year, month)
);
CREATE INDEX idx_accounting_period_status ON accounting_periods(organization_id, status, year, month);

INSERT INTO permissions (id, code, description_ar) VALUES
  (gen_random_uuid(), 'periods.manage', 'إدارة إقفال الفترات المحاسبية'),
  (gen_random_uuid(), 'periods.override', 'تجاوز فترة محاسبية مقفلة بسبب موثق')
ON CONFLICT (code) DO UPDATE SET description_ar = EXCLUDED.description_ar;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('periods.manage', 'periods.override')
WHERE r.name = 'مدير النظام'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'periods.manage'
WHERE r.name = 'مدير المديونية'
ON CONFLICT DO NOTHING;

