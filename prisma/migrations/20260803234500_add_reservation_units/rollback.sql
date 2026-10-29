-- Manual feature rollback. The legacy reservations.unit text is retained by the forward migration,
-- so removing normalized-unit support does not discard the original unit labels.
-- Run only after deploying application code that no longer reads reservations.unit_id.

ALTER TABLE "reservations" DROP CONSTRAINT IF EXISTS "reservations_unit_id_fkey";
DROP INDEX IF EXISTS "idx_reservations_status_expiry";
ALTER TABLE "reservations" DROP COLUMN IF EXISTS "unit_id";
DROP TABLE IF EXISTS "units";

-- The broadened non-negative amount/status checks are deliberately retained: narrowing them again
-- could invalidate goods reservations created while this feature was enabled.
