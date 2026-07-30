# البناء الراقي — AlBinaa Platform

نظام إدارة المديونية والتحصيل — الإصدار 1.0 Stable

## الوصف

منصة متكاملة لإدارة المديونيات والتحصيلات، تتضمن:
- **Backend** (NestJS + Prisma + PostgreSQL)
- **Web Dashboard** (Next.js)
- **Mobile App** (React Native + Expo)
- **Mobile Sync** مع دعم العمل دون اتصال
- **Import Pipeline** لاستيراد البيانات من ملفات Excel/CSV
- **Push Notifications** (داخلية)
- **JWT Authentication** مع Refresh Token
- **Role-Based Access Control** (RBAC) مع 30+ صلاحية

## البنية التقنية

| المكوّن | التقنية | الإصدار |
|---------|---------|---------|
| Backend | NestJS | 10.x |
| ORM | Prisma | 5.x |
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

## الإصدار

- **v1.0.0** (2026-07-30) — الإصدار المستقر الأول
- انظر [CHANGELOG.md](./CHANGELOG.md) للتفاصيل
