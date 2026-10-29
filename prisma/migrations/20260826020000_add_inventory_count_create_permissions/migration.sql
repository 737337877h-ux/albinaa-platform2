INSERT INTO "permissions" ("id", "code", "description_ar")
VALUES
  (gen_random_uuid(), 'oracle_test_requests.inventory_count.create', 'إنشاء مسودة جرد متعددة الأصناف في IAS20191'),
  (gen_random_uuid(), 'mobile.inventory_count.create', 'تطبيق الهاتف: إنشاء مسودة جرد في IAS20191')
ON CONFLICT ("code") DO UPDATE SET "description_ar" = EXCLUDED."description_ar";

-- صلاحيات الكتابة الجديدة تبدأ بمدير النظام فقط، ويمكن تفويضها لاحقًا من شاشة الأدوار.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."name" = 'مدير النظام'
  AND permission."code" IN (
    'oracle_test_requests.inventory_count.create',
    'mobile.inventory_count.create'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
