# تثبيت منصة البناء الراقي

## المتطلبات

| المكوّن | الحد الأدنى | ملاحظات |
|---------|------------|---------|
| Node.js | 22+ | `node --version` |
| Docker | 24+ | مع Docker Compose V2 |
| PostgreSQL | 16 | أو عبر Docker |
| Python | 3.10+ | مع `openpyxl` (لاستيراد Excel) |
| Git | 2.30+ | |

## تثبيت محلي (Development)

### 1. استنساخ المستودع
```bash
git clone https://github.com/737337877h-ux/albinaa-platform2.git
cd albinaa-platform
```

### 2. إعداد قاعدة البيانات
```bash
# تشغيل PostgreSQL عبر Docker
docker compose up -d db

# التحقق من التشغيل
docker compose ps
```

### 3. إعداد Backend
```bash
cd backend

# نسخ ملف البيئة
cp .env.example .env

# تعديل DATABASE_URL ليتوافق مع Docker
# DATABASE_URL="postgresql://albinaa:albinaa_dev_only@localhost:6543/albinaa?schema=public"

# تثبيت التبعيات
npm install

# توليد Prisma Client
npx prisma generate --schema=../prisma/schema.prisma

# تطبيق Migrations
npx prisma migrate deploy --schema=../prisma/schema.prisma

# إدخال البيانات المرجعية
npx prisma db seed
# أو
npm run prisma:seed
```

### 4. إعداد Frontend
```bash
cd ../frontend

# تثبيت التبعيات
npm install

# نسخ ملف البيئة (اختياري)
cp .env.example .env.local
```

### 5. تشغيل
```bash
# Terminal 1 — Backend
cd backend
npm run start:dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

### 6. التحقق
- Frontend: http://localhost:18001
- Backend API: http://localhost:18000
- Swagger Docs: http://localhost:18000/docs (development فقط)
- Health Check: http://localhost:18000/health

## تثبيت الإنتاج

راجع [DEPLOYMENT.md](DEPLOYMENT.md) للتفاصيل.

## حل المشاكل الشائعة

### الخطأ: `password authentication failed`
تأكد من أن PostgreSQL يعمل على المنفذ الصحيح (6543) وأن DATABASE_URL يطابق.

### الخطأ: `python3: command not found`
مثبّت Python 3 و `openpyxl`:
```bash
pip install openpyxl
# أو
pip3 install openpyxl
```

### الخطأ: `EACCES: permission denied` على المنفذ
غيّر المنفذ في `.env`:
```
PORT=18000
```
