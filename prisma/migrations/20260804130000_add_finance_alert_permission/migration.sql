INSERT INTO permissions (id, code, description_ar)
VALUES (gen_random_uuid(), 'finance.alerts.receive', 'استلام التنبيهات المالية الفورية')
ON CONFLICT (code) DO UPDATE SET description_ar = EXCLUDED.description_ar;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'finance.alerts.receive'
WHERE r.name IN ('مدير النظام', 'مدير المديونية')
ON CONFLICT (role_id, permission_id) DO NOTHING;

