ALTER TABLE "currencies"
ADD COLUMN "exchange_rate" NUMERIC(18,6) NOT NULL DEFAULT 1;

COMMENT ON COLUMN "currencies"."exchange_rate"
IS 'عدد وحدات العملة الأساسية المقابلة لوحدة واحدة من هذه العملة؛ لا تستخدم للجمع إلا بتقرير يصرح بالتحويل';
