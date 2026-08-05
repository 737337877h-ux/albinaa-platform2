CREATE TABLE "collector_targets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "collector_id" UUID NOT NULL,
  "currency_code" TEXT NOT NULL,
  "month" DATE NOT NULL,
  "target_amount" DECIMAL(18,4) NOT NULL,
  "set_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collector_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collector_targets_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "collector_targets_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "collector_targets_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_collector_target_month_currency" ON "collector_targets"("collector_id", "currency_code", "month");
CREATE INDEX "idx_collector_targets_month_currency" ON "collector_targets"("month", "currency_code");
