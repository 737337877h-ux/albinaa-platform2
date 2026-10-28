CREATE TABLE IF NOT EXISTS "mobile_device_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" VARCHAR(120) NOT NULL,
  "device_name" VARCHAR(160),
  "platform" VARCHAR(30) NOT NULL,
  "app_version" VARCHAR(30),
  "last_connected_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_synced_at" TIMESTAMPTZ,
  "last_response_ms" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_mobile_device_sessions_user_device" ON "mobile_device_sessions"("user_id", "device_id");
CREATE INDEX IF NOT EXISTS "idx_mobile_device_sessions_connected" ON "mobile_device_sessions"("last_connected_at");
