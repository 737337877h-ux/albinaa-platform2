-- Administrative follow-up closure is distinct from receipt-backed fulfillment.
-- Preserve every existing state and all promise/receipt amounts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE payment_promises
    DROP CONSTRAINT chk_promise_status,
    ADD CONSTRAINT chk_promise_status CHECK (status IN
        ('upcoming','due_today','fulfilled','partially_fulfilled',
         'unfulfilled','postponed','cancelled_approved','closed_settled'));
COMMIT;
