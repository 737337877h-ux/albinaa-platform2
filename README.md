# منصة البناء الراقي لإدارة المديونية والتحصيل
## Sprint 1 — Data Foundation (النواة التشغيلية)

هذا المستودع يحتوي على أساس البيانات المعتمد: مخطط PostgreSQL الكامل (36 جدولاً)،
وMigrations جاهزة، وPrisma مهيأ، وبيانات Seed المرجعية المستخرجة من التحليل الفعلي
لملف `عملاء_تحليلي_16-07-2026.xlsx`.

---

## المتطلبات
- Docker + Docker Compose
- Node.js 20+
- اتصال إنترنت لتنزيل حزم npm (مرة واحدة)

## خطوات التشغيل (أمر واحد)

```bash
cp .env.example .env        # ثم عدّل كلمات المرور
npm install                 # ينزّل prisma و @prisma/client
npm run setup               # يشغّل: قاعدة البيانات + Migrations + Seed + الفحص
```

أو خطوة بخطوة:

```bash
npm run db:up               # PostgreSQL 16 عبر Docker (بترتيب عربي ICU صحيح)
npm run db:migrate          # prisma migrate deploy — يطبق 20260717000000_init
npx prisma generate         # توليد Prisma Client
npm run db:seed             # العملات + أنواع المستندات + الأدوار + admin
npm run db:verify           # 11 فحصًا للتأكد من الجداول والقيود والـ Triggers
```

## ما الذي أنشأه هذا الـ Sprint؟

| المكوّن | التفاصيل |
|---|---|
| 36 جدولاً | كامل المخطط المعتمد v2: الهيكل التنظيمي، RBAC، العملاء، الأرصدة متعددة العملات، الاستيراد، الدفتر التشغيلي، التسوية، المتابعات، الوعود، التحصيل، الصندوق، الحجوزات، التدقيق |
| القيود الحرجة | `UNIQUE(customer_id, currency_code)` على الأرصدة، `UNIQUE(line_hash)` على الحركات، فهرس جزئي يضمن إسنادًا حاليًا واحدًا لكل عميل، CHECK على المبالغ والحالات |
| Append-Only | Triggers تمنع UPDATE/DELETE على `operational_ledger` و`audit_logs`، وتمنع DELETE على `collections` (التصحيح بعكس موثق فقط) |
| الرصيد التشغيلي | Materialized View `operational_balances` — لا يُعدّل يدويًا أبدًا، يُعاد بناؤه بالكامل من الدفتر: `REFRESH MATERIALIZED VIEW CONCURRENTLY operational_balances;` |
| Seed | 3 عملات، 9 أنواع مستندات (بالأثر المرصود من 7,102 حركة فعلية)، 5 أدوار نظامية، 20 صلاحية، منشأة "البناء الراقي" + الفرع الرئيسي + مستخدم admin |

## بنية المشروع

```
albinaa-platform/
├── docker-compose.yml                  # PostgreSQL 16 (ICU Arabic collation)
├── package.json                        # سكربتات التشغيل
├── .env.example
├── prisma/
│   ├── schema.prisma                   # 36 موديل مطابقة للمخطط حرفيًا
│   ├── seed.js                         # بيانات مرجعية idempotent
│   └── migrations/
│       └── 20260717000000_init/
│           └── migration.sql           # DDL المعتمد + Triggers + MatView
└── scripts/
    ├── verify_migration.sql            # فحوصات ما بعد الترحيل
    └── albinaa_parser.py               # معالج الاستيراد المُختبر (من مرحلة التحقق)
```

## قرارات معمارية مهمة

1. **`migrate deploy` وليس `migrate dev`** في بيئات التشغيل: لأن الـ migration يحتوي
   SQL مخصصًا (Triggers، Materialized View، فهرس جزئي، CHECK) لا يمثّله Prisma في
   الـ schema. عند تطوير المخطط لاحقًا: عدّل `schema.prisma` ثم
   `npx prisma migrate dev --create-only` وأضف أي SQL مخصص للملف الناتج قبل التطبيق.
2. **كلمات المرور**: Seed يستخدم `crypto.scrypt` المدمج في Node (بدون تبعيات).
   طبقة الـ Backend في Sprint 2 ستتحقق بنفس الصيغة `scrypt$N=...$salt$hash`.
3. **الترتيب العربي**: قاعدة البيانات مهيأة بـ ICU Arabic collation لفرز أسماء
   العملاء فرزًا عربيًا صحيحًا.

## Milestone 2 — API Foundation ✅
راجع `backend/README.md`: NestJS + JWT + RBAC + Audit + Swagger + اختبارات E2E.
التشغيل الكامل: `docker compose up -d --build` ثم Seed مرة واحدة.

## القادم (Milestone 3 — بانتظار الاعتماد)
- Import Excel API (نقل المعالج المختبر إلى NestJS).
- Customers API + Customer 360.
