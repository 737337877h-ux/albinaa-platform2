CREATE TABLE "customer_credit_limits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL,
  "currency_code" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "effective_from" DATE NOT NULL DEFAULT CURRENT_DATE,
  "approved_by" UUID NOT NULL,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_credit_limits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_credit_limits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_credit_limits_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_credit_limits_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_customer_credit_limit_currency" ON "customer_credit_limits"("customer_id", "currency_code");
CREATE INDEX "idx_credit_limits_currency_amount" ON "customer_credit_limits"("currency_code", "amount");

INSERT INTO "customer_credit_limits" ("customer_id", "currency_code", "amount", "effective_from", "approved_by", "approved_at")
SELECT p."customer_id", p."credit_limit_currency", p."credit_limit_amount",
       COALESCE(p."decided_at"::date, CURRENT_DATE), p."decided_by", COALESCE(p."decided_at", CURRENT_TIMESTAMP)
FROM "customer_credit_policies" p
WHERE p."credit_limit_amount" IS NOT NULL AND p."credit_limit_currency" IS NOT NULL AND p."decided_by" IS NOT NULL
ON CONFLICT ("customer_id", "currency_code") DO NOTHING;

INSERT INTO "permissions" ("id", "code", "description_ar")
VALUES (gen_random_uuid(), 'credit.override', 'تجاوز سقف الائتمان بسبب موثق')
ON CONFLICT ("code") DO UPDATE SET "description_ar" = EXCLUDED."description_ar";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", permission."id"
FROM "role_permissions" rp
JOIN "permissions" manager_permission ON manager_permission."id" = rp."permission_id" AND manager_permission."code" = 'reservations.manage'
JOIN "permissions" permission ON permission."code" = 'credit.override'
ON CONFLICT DO NOTHING;
