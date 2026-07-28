# منصة البناء الراقي لإدارة المديونية والتحصيل

نظام متكامل لإدارة المديونية والتحصيل مبني على NestJS + Next.js + PostgreSQL.

## الميزات

- لوحة تحكم بمؤشرات إحصائية (مدير + محصل)
- إدارة العملاء مع بروفايل 360 شامل
- متابعة العملاء (Followups) مع تقويم
- وعود السداد مع آلة حالة (upcoming → fulfilled/unfulfilled)
- تحصيل المدفوعات مع عكس موثق
- استيراد بيانات Excel مع تحقق وتدقيق
- نظام صلاحيات RBAC (5 أدوار، 20 صلاحية)
- دعم العملات المتعددة (YER, SAR, USD)
- واجهة عربية كاملة مع RTL ووضع مظلم

## المتطلبات

- Node.js 22+
- Docker + Docker Compose (للإنتاج)
- PostgreSQL 16 (أو عبر Docker)

## التشغيل السريع

```bash
# 1. استنساخ المستودع
git clone https://github.com/737337877h-ux/albinaa-platform2.git
cd albinaa-platform

# 2. إعداد قاعدة البيانات
docker compose up -d db
cp backend/.env.example backend/.env
# عدّل DATABASE_URL في backend/.env (المنفذ 6543)

# 3. تطبيق Migrations والبيانات المرجعية
cd backend
npx prisma migrate deploy --schema=../prisma/schema.prisma
npx prisma db seed

# 4. تشغيل Backend
npm run start:dev
# يعمل على http://localhost:18000

# 5. تشغيل Frontend
cd ../frontend
npm install
npm run dev
# يعمل على http://localhost:18001
```

## بيانات الدخول الافتراضية

| المستخدم | كلمة المرور |
|----------|------------|
| admin | ChangeMe!2026 |

> غيّر كلمة المرور فور أول تسجيل دخول.

## بنية المشروع

```
albinaa-platform/
├── backend/               # NestJS API (Port 18000 dev / 3000 prod)
├── frontend/              # Next.js App (Port 18001 dev / 3001 prod)
├── prisma/                # Schema + Migrations + Seed
├── parser/                # Python Excel parser
├── nginx/                 # Reverse proxy config (production)
├── scripts/               # Backup/restore scripts
├── docker-compose.yml     # Development Docker
├── docker-compose.prod.yml # Production Docker (3 services + nginx + backup)
└── .env.prod.example      # Production environment template
```

## أوامر مفيدة

```bash
# Backend
npm run start:dev          # تشغيل براقبة
npm run build              # بناء
npm run test               # اختبارات وحدة
npm run test:e2e           # اختبارات E2E
npm run typecheck          # فحص الأنواع

# Frontend
npm run dev                # تشغيل براقبة
npm run build              # بناء إنتاج
npm run test               # اختبارات vitest

# قاعدة البيانات
docker compose up -d db    # تشغيل PostgreSQL
npx prisma migrate dev     # تطوير migration
npx prisma migrate deploy  # تطبيق migration
npx prisma db seed         # بيانات مرجعية
```

## التوثيق

- [INSTALL.md](INSTALL.md) — خطوات التثبيت التفصيلية
- [DEPLOYMENT.md](DEPLOYMENT.md) — نشر الإنتاج
- [BACKUP.md](BACKUP.md) — النسخ الاحتياطي والاستعادة
- [SECURITY.md](SECURITY.md) — مراجعة الأمان
- [CHANGELOG.md](CHANGELOG.md) — سجل التغييرات

## الرخصة

proprietary — البناء الراقي
