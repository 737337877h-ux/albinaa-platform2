# دليل التثبيت — البناء الراقي v1.0

## المتطلبات الأساسية

| المكوّن | الحد الأدنى | المُوصى |
|---------|-------------|---------|
| Node.js | 20.x | 22.x |
| npm | 10.x | 11.x |
| Docker | 24+ | 26+ |
| Docker Compose | 2.20+ | أحدث |
| PostgreSQL | 14 | 16 |
| Expo CLI | - | latest |

## 1. الاستنساخ

```bash
git clone https://github.com/737337877h-ux/albinaa-platform2.git
cd albinaa-platform
```

## 2. إعداد البيئة للتطوير

```bash
# نسخ ملفات البيئة
cp .env.example .env
cp .env.prod.example .env.prod
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# توليد JWT secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# ضع القيم المولّدة في:
#   - backend/.env (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET)
#   - .env.prod (للإنتاج)
```

## 3. التشغيل عبر Docker (الأسهل)

```bash
# بناء وتشغيل كل الخدمات
docker compose up -d

# التحقق من الحالة
docker compose ps
docker compose logs -f backend

# الدخول إلى حاوية الـbackend
docker compose exec backend sh

# تنفيذ migrations
docker compose exec backend npx prisma migrate deploy

# تهيئة admin الافتراضي (اختياري - يُنفذ تلقائياً عند أول تشغيل)
docker compose exec backend node dist/scripts/seed.js
```

الخدمات المتاحة:
- **Backend API**: http://localhost:3000
- **Swagger UI**: http://localhost:3000/docs
- **Frontend Dashboard**: http://localhost:3001
- **PostgreSQL**: localhost:6543
- **Nginx** (production only): http://localhost:80

## 4. التشغيل اليدوي (للتطوير)

### الـBackend
```bash
cd backend
npm install

# تأكد من تشغيل PostgreSQL
# .env: DATABASE_URL=postgresql://albinaa:albinaa@localhost:5432/albinaa

npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

### الـFrontend
```bash
cd frontend
npm install
npm run dev
```

### الـMobile
```bash
cd mobile
npm install

# تشغيل Metro bundler
npx expo start

# في نافذة أخرى، بناء APK للاختبار
npx expo prebuild --platform android
cd android
./gradlew assembleDebug
```

## 5. المستخدم الافتراضي

عند أول تشغيل، يتم إنشاء مستخدم admin تلقائياً:
- **Username**: `admin`
- **Password**: قيمة `ADMIN_INITIAL_PASSWORD` من البيئة (الافتراضي: `ChangeMe!2026`)

⚠️ **غيّر كلمة المرور فوراً بعد أول تسجيل دخول.**

## 6. التحقق من التثبيت

```bash
# اختبار صحة الـBackend
curl http://localhost:3000/health

# يجب أن يعيد:
# {"status":"ok","version":"1.0.0","environment":"development",...}

# اختبار قاعدة البيانات
curl http://localhost:3000/health/database

# اختبار تسجيل الدخول
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ChangeMe!2026"}'
```

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| `ECONNREFUSED 5432` | تأكد من تشغيل PostgreSQL |
| `JWT secret invalid` | تأكد من تعيين `JWT_ACCESS_SECRET` و`JWT_REFRESH_SECRET` |
| `Prisma Client not generated` | شغّل `npx prisma generate` |
| `EACCES port 3000` | غيّر `PORT` في `.env` |
| Mobile build fails | تأكد من تثبيت Android SDK وJDK 17 |

## التحديث

```bash
git pull origin main
docker compose build --no-cache
docker compose up -d --force-recreate
docker compose exec backend npx prisma migrate deploy
```

## الدعم

راجع [docs/](./docs/) أو افتح issue في GitHub.
