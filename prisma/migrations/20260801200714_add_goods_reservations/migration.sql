-- Goods reservations (PR-F): additive-only migration.
-- Does NOT drop reservation_items, and does NOT drop credit_amount/used_amount/payment_date —
-- those legacy columns/table are kept as-is (unused by app code) for safety.

-- AlterTable
ALTER TABLE "reservations"
ADD COLUMN     "item_name" TEXT,
ADD COLUMN     "item_type" TEXT,
ADD COLUMN     "quantity" DECIMAL(18,4),
ADD COLUMN     "unit" TEXT,
ADD COLUMN     "unit_price" DECIMAL(18,4),
ADD COLUMN     "total_amount" DECIMAL(18,4),
ADD COLUMN     "issued_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "remaining_qty" DECIMAL(18,4),
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET DEFAULT 'open';

-- CreateIndex
CREATE INDEX "idx_reservations_customer" ON "reservations"("customer_id");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
