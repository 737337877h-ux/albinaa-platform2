ALTER TABLE "device_push_tokens"
ADD COLUMN IF NOT EXISTS "application_id" TEXT NOT NULL DEFAULT 'com.albinaa.collector';
