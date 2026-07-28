-- Migration: add_idempotency_keys
-- Milestone 8 — Backend Idempotency for mobile mutation endpoints
-- يخزّن الردود الأولية لمفاتيح Idempotency لمنع تكرار العمليات

CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "idx_idempotency_created" ON "idempotency_keys" ("created_at");

-- تنظيف المفاتيح الأقدم من 24 ساعة (يعمل مرة يومياً)
-- يتم استدعاؤه من تطبيق NestJS عبر Prisma
