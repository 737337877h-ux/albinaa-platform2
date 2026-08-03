# البناء الراقي — AlBinaa Platform

نظام إدارة المديونية والتحصيل — مرشح v1.3.0

> الإصدار المعلن في الحزم ما زال `1.2.1` إلى أن تكتمل مراجعة وإصدار v1.3 رسميًا،
> لكن `main` يتضمن بالفعل وحدات v1.3 المدمجة حتى الحسابات التحليلية.

## الوصف

منصة متكاملة لإدارة المديونيات والتحصيلات، تتضمن:
- **Backend** (NestJS + Prisma + PostgreSQL)
- **Web Dashboard** (Next.js)
- **Mobile App** (React Native + Expo)
- **Mobile Sync** مع دعم العمل دون اتصال
- **Import Pipeline** لاستيراد البيانات من ملفات Excel/CSV
- **In-app Notifications** (داخلية؛ FCM/APNS ما زال ضمن العمل المتبقي)
- **JWT Authentication** مع Refresh Token
- **Role-Based Access Control** (RBAC) مع 30+ صلاحية

## البنية التقنية

| المكوّن | التقنية | الإصدار |
|---------|---------|---------|
| Backend | NestJS | 10.x |
| ORM | Prisma | 6.x |
| Database | PostgreSQL | 16 |
| Cache | Redis (اختياري) | - |
| Frontend | Next.js | 14.x |
| Mobile | React Native + Expo SDK | 57 |
| Auth | JWT (Access + Refresh) | - |
| File Upload | Multer (disk) | - |
| API Docs | Swagger | - |

## المكوّنات

```
albinaa-platform/
├── backend/        # NestJS API
├── frontend/       # Next.js Dashboard
├── mobile/         # React Native App
├── prisma/         # Prisma schema + migrations
├── nginx/          # Reverse proxy configs
├── scripts/        # Backup, deploy, etc.
├── docker-compose.yml        # Development
├── docker-compose.prod.yml   # Production
└── docs/           # Documentation
```

## البدء السريع

```bash
# 1. استنساخ المشروع
git clone https://github.com/737337877h-ux/albinaa-platform2.git
cd albinaa-platform

# 2. تشغيل التطوير (Docker)
docker compose up -d

# 3. تشغيل الـBackend محلياً
cd backend
npm install
npm run start:dev

# 4. تشغيل الـMobile
cd mobile
npm install
npx expo start
```

راجع [INSTALL.md](./INSTALL.md) للتفاصيل الكاملة و[DEPLOYMENT.md](./DEPLOYMENT.md) للنشر.

## الاختبار

```bash
# Backend
cd backend
npm run typecheck && npm run lint && npm test

# Mobile
cd mobile
npx tsc --noEmit && npx expo-doctor && npx jest
```

## الترخيص

جميع الحقوق محفوظة © 2026 البناء الراقي

## التوثيق

| المستند | الوصف |
|---------|-------|
| [PROJECT_STATE.md](./PROJECT_STATE.md) | حالة المشروع الحالية |
| [CHANGELOG.md](./CHANGELOG.md) | سجل التغييرات |
| [RELEASE_NOTES_v1.2.1.md](./RELEASE_NOTES_v1.2.1.md) | ملاحظات إصدار v1.2.1 (Web Hotfix) |
| [RELEASE_NOTES_v1.2.0.md](./RELEASE_NOTES_v1.2.0.md) | ملاحظات إصدار v1.2.0 |
| [V11_DELIVERY_REPORT.md](./V11_DELIVERY_REPORT.md) | تقرير تسليم v1.1.0 الكامل |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | توثيق قاعدة البيانات / Prisma Schema |
| [ROADMAP.md](./ROADMAP.md) | خارطة الطريق |
| [INSTALL.md](./INSTALL.md) | التثبيت |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | النشر |
| [BACKUP.md](./BACKUP.md) / [RESTORE.md](./RESTORE.md) | النسخ الاحتياطي والاستعادة |

## الإصدار

- **v1.3.0 RC** (قيد المراجعة) — إدارة المستخدمين والمحصلين، إدارة الأدوار والصلاحيات، الإسناد الجماعي، Dashboard drill-down، جودة البيانات، حجوزات البضاعة، والحسابات التحليلية
- **v1.2.1** (2026-08-01) — صفحة الإشعارات الكاملة (Web Hotfix): قائمة + تعليم كمقروء/الكل + مزامنة جرس الإشعارات
- **v1.2.0** (2026-08-01) — إدارة المديونية الذكية: Import Profiles + Debt Aging · Risk Score · Daily Work Queue · Customer360 Risk/Tasks · Dashboard KPIs · Customer Assignments · Task Execution + Followup + Promise · Stabilization 122/122
- **v1.1.0** (2026-07-30) — أدوات التواصل مع العملاء (Call/SMS/WhatsApp، خريطة، إشعارات تفاعلية، عملات ديناميكية)
- **v1.0.0** (2026-07-30) — الإصدار المستقر الأول
