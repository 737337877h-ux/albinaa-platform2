ALTER TABLE payment_promises
  ADD COLUMN settlement_date DATE,
  ADD COLUMN settled_late BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN missed_due_date DATE;

CREATE TABLE payment_promise_receipt_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  promise_id UUID NOT NULL REFERENCES payment_promises(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  receipt_key VARCHAR(500) NOT NULL,
  receipt_amount NUMERIC(18,4) NOT NULL CHECK (receipt_amount > 0),
  amount NUMERIC(18,4) NOT NULL CHECK (amount > 0 AND amount <= receipt_amount),
  receipt_date DATE NOT NULL,
  source VARCHAR(30) NOT NULL CHECK (source IN ('local_collection', 'oracle_receipt')),
  source_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_promise_receipt_allocation UNIQUE (organization_id, receipt_key, promise_id)
);
CREATE INDEX idx_promise_receipt_capacity ON payment_promise_receipt_allocations (organization_id, receipt_key);
CREATE INDEX idx_promise_receipt_promise ON payment_promise_receipt_allocations (promise_id);

-- Guard the capacity in the database as well as in the planner. The advisory
-- lock serializes inserts for one receipt, even from different sessions.
CREATE FUNCTION guard_promise_receipt_allocation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  existing_amount NUMERIC(18,4);
  existing_capacity NUMERIC(18,4);
  promise_amount NUMERIC(18,4);
  promise_allocated NUMERIC(18,4);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Promise receipt allocations are append-only; corrections require an audited migration';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('promise-receipt|' || NEW.organization_id::TEXT || '|' || NEW.receipt_key, 0));
  SELECT p.expected_amount INTO promise_amount
    FROM payment_promises p JOIN customers c ON c.id = p.customer_id
    WHERE p.id = NEW.promise_id AND p.customer_id = NEW.customer_id
      AND p.currency_code = NEW.currency_code AND c.organization_id = NEW.organization_id
    FOR UPDATE OF p;
  IF promise_amount IS NULL THEN
    RAISE EXCEPTION 'Promise allocation customer, currency or organization does not match';
  END IF;
  SELECT COALESCE(SUM(amount), 0), MIN(receipt_amount) INTO existing_amount, existing_capacity
    FROM payment_promise_receipt_allocations
    WHERE organization_id = NEW.organization_id AND receipt_key = NEW.receipt_key;
  IF existing_capacity IS NOT NULL AND existing_capacity <> NEW.receipt_amount THEN
    RAISE EXCEPTION 'Receipt allocation capacity changed';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_promise_receipt_allocations
    WHERE organization_id = NEW.organization_id AND receipt_key = NEW.receipt_key
      AND (customer_id <> NEW.customer_id OR currency_code <> NEW.currency_code OR receipt_date <> NEW.receipt_date)) THEN
    RAISE EXCEPTION 'Receipt identity has conflicting customer, currency or date';
  END IF;
  IF existing_amount + NEW.amount > NEW.receipt_amount THEN
    RAISE EXCEPTION 'Receipt amount has already been allocated';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO promise_allocated
    FROM payment_promise_receipt_allocations WHERE promise_id = NEW.promise_id;
  IF promise_allocated + NEW.amount > promise_amount THEN
    RAISE EXCEPTION 'Allocation exceeds promise amount';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_promise_receipt_allocation
  BEFORE INSERT OR UPDATE OR DELETE ON payment_promise_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_promise_receipt_allocation();
