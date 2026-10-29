WITH mobile_permissions(code, description_ar) AS (
  VALUES
    ('mobile.dashboard.view', 'تطبيق الهاتف: عرض الصفحة الرئيسية'),
    ('mobile.tasks.view', 'تطبيق الهاتف: عرض المهام'),
    ('mobile.tasks.create', 'تطبيق الهاتف: إنشاء مهمة'),
    ('mobile.customers.view', 'تطبيق الهاتف: عرض العملاء'),
    ('mobile.advances.view', 'تطبيق الهاتف: عرض السلف'),
    ('mobile.collections.view', 'تطبيق الهاتف: عرض التحصيلات'),
    ('mobile.collections.create', 'تطبيق الهاتف: تسجيل تحصيل'),
    ('mobile.followups.view', 'تطبيق الهاتف: عرض المتابعات'),
    ('mobile.followups.create', 'تطبيق الهاتف: تسجيل متابعة'),
    ('mobile.promises.view', 'تطبيق الهاتف: عرض وعود السداد'),
    ('mobile.promises.create', 'تطبيق الهاتف: تسجيل وعد سداد'),
    ('mobile.reservations.view', 'تطبيق الهاتف: عرض حجوزات البضاعة'),
    ('mobile.reservations.create', 'تطبيق الهاتف: إضافة حجز بضاعة'),
    ('mobile.inventory.view', 'تطبيق الهاتف: عرض الأصناف والمخزون'),
    ('mobile.receipts.view', 'تطبيق الهاتف: معاينة صور الإيصالات'),
    ('mobile.receipts.upload', 'تطبيق الهاتف: رفع صورة إيصال'),
    ('mobile.location.view', 'تطبيق الهاتف: عرض الموقع'),
    ('mobile.location.update', 'تطبيق الهاتف: تحديث الموقع'),
    ('mobile.financial_adjustments.request', 'تطبيق الهاتف: طلب خصم أو تصفية'),
    ('mobile.assignment_change.request', 'تطبيق الهاتف: طلب تغيير الإسناد'),
    ('mobile.notifications.view', 'تطبيق الهاتف: عرض الإشعارات'),
    ('mobile.messages.view', 'تطبيق الهاتف: استخدام قوالب الرسائل')
)
INSERT INTO "permissions" ("id", "code", "description_ar")
SELECT gen_random_uuid(), code, description_ar FROM mobile_permissions
ON CONFLICT ("code") DO UPDATE SET "description_ar" = EXCLUDED."description_ar";

WITH permission_map(mobile_code, legacy_code) AS (
  VALUES
    ('mobile.dashboard.view', 'tasks.manage'),
    ('mobile.tasks.view', 'tasks.manage'),
    ('mobile.tasks.create', 'tasks.manage'),
    ('mobile.customers.view', 'customers.read'),
    ('mobile.advances.view', 'customers.read'),
    ('mobile.collections.view', 'collections.create'),
    ('mobile.collections.create', 'collections.create'),
    ('mobile.followups.view', 'followups.create'),
    ('mobile.followups.create', 'followups.create'),
    ('mobile.promises.view', 'promises.create'),
    ('mobile.promises.create', 'promises.create'),
    ('mobile.reservations.view', 'reservations.read'),
    ('mobile.reservations.create', 'reservations.create'),
    ('mobile.receipts.view', 'collections.create'),
    ('mobile.receipts.upload', 'collections.create'),
    ('mobile.location.view', 'customers.read'),
    ('mobile.location.update', 'followups.create'),
    ('mobile.financial_adjustments.request', 'collections.create'),
    ('mobile.assignment_change.request', 'tasks.manage'),
    ('mobile.notifications.view', 'tasks.manage'),
    ('mobile.messages.view', 'followups.create')
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", mobile_permission."id"
FROM permission_map mapping
JOIN "permissions" legacy_permission ON legacy_permission."code" = mapping.legacy_code
JOIN "role_permissions" rp ON rp."permission_id" = legacy_permission."id"
JOIN "permissions" mobile_permission ON mobile_permission."code" = mapping.mobile_code
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."name" = 'مدير النظام' AND permission."code" LIKE 'mobile.%'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
