-- HR-1: normalized units for reliable reservation weight calculations.
-- The legacy reservations.unit text is intentionally retained for rollback and data-quality review.

-- Goods reservations do not consume the legacy credit reservation amount.
-- Keep the legacy column and its non-negative invariant, but allow the documented zero sentinel.
ALTER TABLE "reservations" DROP CONSTRAINT "chk_res_amount";
ALTER TABLE "reservations" ADD CONSTRAINT "chk_res_amount" CHECK ("credit_amount" >= 0);
ALTER TABLE "reservations" DROP CONSTRAINT "chk_res_status";
ALTER TABLE "reservations" ADD CONSTRAINT "chk_res_status" CHECK ("status" IN (
  'active', 'partially_received', 'fully_received', 'refunded',
  'open', 'partial', 'completed', 'expired', 'cancelled'
));

CREATE TABLE "units" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name_ar" TEXT NOT NULL,
  "weight_kg" DECIMAL(14,4),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

INSERT INTO "units" ("code", "name_ar", "weight_kg") VALUES
  ('TON', 'طن', 1000),
  ('BAG50', 'كيس 50كجم', 50),
  ('BAG25', 'كيس 25كجم', 25),
  ('PCS', 'حبة', NULL),
  ('ROLL', 'لفة', NULL);

ALTER TABLE "reservations" ADD COLUMN "unit_id" UUID;

UPDATE "reservations" r
SET "unit_id" = u."id"
FROM "units" u
WHERE u."code" = CASE
  WHEN lower(trim(r."unit")) IN ('طن', 'ton', 't') THEN 'TON'
  WHEN lower(trim(r."unit")) IN ('كيس 50كجم', 'كيس 50 كجم', 'bag50', 'bag 50kg') THEN 'BAG50'
  WHEN lower(trim(r."unit")) IN ('كيس 25كجم', 'كيس 25 كجم', 'bag25', 'bag 25kg') THEN 'BAG25'
  WHEN lower(trim(r."unit")) IN ('حبة', 'قطعة', 'عدد', 'pcs', 'piece') THEN 'PCS'
  WHEN lower(trim(r."unit")) IN ('لفة', 'roll') THEN 'ROLL'
  ELSE NULL
END;

CREATE INDEX "idx_reservations_status_expiry" ON "reservations"("status", "expires_at");
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "description_ar") VALUES
  (gen_random_uuid(), 'reservations.read', 'عرض حجوزات البضاعة'),
  (gen_random_uuid(), 'reservations.create', 'إنشاء حجوزات البضاعة'),
  (gen_random_uuid(), 'reservations.deliver', 'تسليم حجوزات البضاعة'),
  (gen_random_uuid(), 'reservations.cancel', 'إلغاء حجوزات البضاعة'),
  (gen_random_uuid(), 'reservations.extend', 'تمديد حجوزات البضاعة')
ON CONFLICT ("code") DO UPDATE SET "description_ar" = EXCLUDED."description_ar";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'reservations.read', 'reservations.create', 'reservations.deliver',
  'reservations.cancel', 'reservations.extend'
)
WHERE r."name" IN ('مدير النظام', 'مدير المديونية')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'reservations.read', 'reservations.create', 'reservations.deliver', 'reservations.extend'
)
WHERE r."name" = 'المحصل'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'reservations.read'
WHERE r."name" = 'المحاسب'
ON CONFLICT DO NOTHING;
