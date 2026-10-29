INSERT INTO "permissions" ("id", "code", "description_ar")
VALUES (gen_random_uuid(), 'inventory.read', 'عرض الأصناف والمخزون في المنصة')
ON CONFLICT ("code") DO UPDATE SET "description_ar" = EXCLUDED."description_ar";

-- Preserve existing access: every role that could open inventory through
-- reports.read receives the new dedicated inventory permission initially.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT existing."role_id", inventory_permission."id"
FROM "role_permissions" existing
JOIN "permissions" reports_permission
  ON reports_permission."id" = existing."permission_id"
 AND reports_permission."code" = 'reports.read'
CROSS JOIN "permissions" inventory_permission
WHERE inventory_permission."code" = 'inventory.read'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
