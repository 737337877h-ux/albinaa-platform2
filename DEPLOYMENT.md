# نشر منصة البناء الراقي في الإنتاج

## البنية العامة

```
                    ┌──────────────┐
   HTTPS :443 ──────│    Nginx     │
                    │  (Reverse    │
   HTTP  :80  ──────│   Proxy)     │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼─────┐ ┌───▼─────┐
        │  Frontend  │ │ Backend │ │ Swagger │
        │  :3001     │ │  :3000  │ │  /docs  │
        └────────────┘ └────┬────┘ └─────────┘
                            │
                     ┌──────▼──────┐
                     │  PostgreSQL  │
                     │    :5432     │
                     └─────────────┘
```

## خطوات النشر

### 1. تحضير الخادم

```bash
# تثبيت Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# تثبيت Docker Compose
sudo apt install docker-compose-plugin
```

### 2. استنساخ المستودع

```bash
git clone https://github.com/737337877h-ux/albinaa-platform2.git
cd albinaa-platform
```

### 3. إعداد ملف البيئة

```bash
cp .env.prod.example .env.prod
nano .env.prod   # عدّل جميع القيم!
```

**القيم الحرجّة:**
- `POSTGRES_PASSWORD` — كلمة مرور قوية (32+ حرف)
- `JWT_ACCESS_SECRET` — `openssl rand -hex 64`
- `JWT_REFRESH_SECRET` — `openssl rand -hex 64` (مختلف عن_ACCESS)
- `ADMIN_INITIAL_PASSWORD` — كلمة مرور قوية (8+ أحرف)
- `CORS_ORIGINS` — نطاق الموقع الفعلي

### 4. تحضير شهادات SSL

```bash
# خيار 1: Let's Encrypt (مجاني)
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com

# نسخ الشهادات
mkdir -p nginx/ssl
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
```

### 5. التشغيل

```bash
# بناء وتشغيل جميع الخدمات
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# التحقق من الحالة
docker compose -f docker-compose.prod.yml ps

# مراقبة السجلات
docker compose -f docker-compose.prod.yml logs -f
```

### 6. تطبيق Seed (مرة واحدة)

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
```

## Health Checks

| Endpoint | الوصف | الاستخدام |
|----------|-------|-----------|
| `GET /health` | حالة عامة | فحص أساسي |
| `GET /health/database` | اتصال قاعدة البيانات | فحص DB |
| `GET /health/ready` | جاهزة للخدمة | Kubernetes readiness |
| `GET /health/live` | الخدمة حية | Kubernetes liveness |

## مراقبة السجلات

```bash
# جميع الخدمات
docker compose -f docker-compose.prod.yml logs -f

# خدمة محددة
docker compose -f docker-compose.prod.yml logs -f backend

# الأخطاء فقط
docker compose -f docker-compose.prod.yml logs -f --tail=100 backend 2>&1 | grep -i error
```

## التحديث

```bash
# سحب أحدث التغييرات
git pull origin main

# إعادة البناء والتشغيل
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# تطبيق migrations جديدة (إن وُجدت)
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

## إيقاف التشغيل

```bash
# إيقاف مؤقت (تحفظ البيانات)
docker compose -f docker-compose.prod.yml stop

# إيقاف وحذف (تحفظ Volumes)
docker compose -f docker-compose.prod.yml down

# إيقاف وحذف كل شيء (بيانات + Volumes) ⚠️
docker compose -f docker-compose.prod.yml down -v
```
