ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "total_tons" DECIMAL(18,6),
  ADD COLUMN IF NOT EXISTS "remaining_tons" DECIMAL(18,6);

UPDATE "reservations" r
SET
  "total_tons" = COALESCE(r."remaining_qty", r."quantity") * u."weight_kg" / 1000,
  "remaining_tons" = COALESCE(r."remaining_qty", r."quantity") * u."weight_kg" / 1000
FROM "units" u
WHERE r."unit_id" = u."id"
  AND u."weight_kg" IS NOT NULL
  AND r."total_tons" IS NULL;

CREATE TABLE IF NOT EXISTS "reservation_adjustments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reservation_id" UUID NOT NULL REFERENCES "reservations"("id") ON DELETE CASCADE,
  "source_movement_id" UUID,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "adjustment_type" VARCHAR(20) NOT NULL,
  "external_item_code" VARCHAR(30) NOT NULL,
  "rods_quantity" DECIMAL(18,4) NOT NULL,
  "rods_per_ton" INTEGER NOT NULL,
  "tons_delta" DECIMAL(18,6) NOT NULL,
  "document_type" VARCHAR(20),
  "document_number" VARCHAR(50),
  "movement_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reversed_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_reservation_adjustment_source"
  ON "reservation_adjustments"("reservation_id", "source_fingerprint");
CREATE INDEX IF NOT EXISTS "idx_reservation_adjustments_reservation"
  ON "reservation_adjustments"("reservation_id", "created_at");

ALTER TABLE "published_inventory_movements"
  ADD COLUMN IF NOT EXISTS "bill_document_type" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "external_customer_code" VARCHAR(30);
