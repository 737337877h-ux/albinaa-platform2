CREATE TABLE IF NOT EXISTS contact_attempts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
 customer_id uuid NOT NULL, collector_id uuid, channel text NOT NULL,
 occurred_at timestamptz NOT NULL, due_at timestamptz NOT NULL,
 baseline text NOT NULL, status text NOT NULL DEFAULT 'pending', finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS contact_attempts_due ON contact_attempts(status,due_at);
CREATE UNIQUE INDEX IF NOT EXISTS contact_attempts_pending_customer ON contact_attempts(user_id,customer_id) WHERE status='pending';
INSERT INTO permissions(code,description_ar) VALUES ('mobile.inventory.cost.view','تطبيق الهاتف: عرض التكلفة للمخزون والأصناف') ON CONFLICT (code) DO UPDATE SET description_ar=EXCLUDED.description_ar;
