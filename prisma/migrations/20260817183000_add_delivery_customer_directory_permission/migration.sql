INSERT INTO permissions (code, description_ar)
VALUES (
  'mobile.delivery.customers.view_all_no_balance',
  'عرض جميع العملاء ومواقعهم دون الأرصدة لمندوب التوصيل'
)
ON CONFLICT (code) DO UPDATE SET description_ar = EXCLUDED.description_ar;
