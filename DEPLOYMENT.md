# دليل النشر للإنتاج — البناء الراقي v1.3

## المتطلبات الإنتاجية

- **خادم**: Linux (Ubuntu 22.04 LTS مُوصى)
- **RAM**: 4 GB كحد أدنى، 8 GB مُوصى
- **CPU**: 2 cores كحد أدنى، 4 cores مُوصى
- **Storage**: 50 GB SSD
- **Docker**: 24+
- **Domain**: نطاق مع شهادة SSL (Let's Encrypt مُوصى)
- **Backup**: مساحة تخزين خارجية للنسخ الاحتياطية

## 1. الإعداد قبل النشر

### 1.1. توليد المفاتيح

```bash
# JWT secrets (64 bytes hex)
JWT_ACCESS=$(openssl rand -hex 64)
JWT_REFRESH=$(openssl rand -hex 64)
ADMIN_PASSWORD=$(openssl rand -base64 24)

# عرضها
echo "JWT_ACCESS_SECRET=$JWT_ACCESS"
echo "JWT_REFRESH_SECRET=$JWT_REFRESH"
echo "ADMIN_INITIAL_PASSWORD=$ADMIN_PASSWORD"
```

احفظها في مكان آمن (مثل Vault أو AWS Secrets Manager).

### 1.2. تجهيز `.env.prod`

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

املأ القيم:

```env
POSTGRES_USER=albinaa_prod
POSTGRES_PASSWORD=STRONG_DB_PASSWORD_HERE
POSTGRES_DB=albinaa_prod

APP_VERSION=1.3.0-rc.1
JWT_ACCESS_SECRET=<from step 1.1>
JWT_REFRESH_SECRET=<from step 1.1>
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800
ADMIN_INITIAL_PASSWORD=<from step 1.1>

CORS_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com

NEXT_PUBLIC_API_URL=https://api.yourdomain.com

HTTPS_PORT=443
HTTP_PORT=80
BACKUP_RETENTION_DAYS=30
MAX_SESSIONS_PER_USER=5
```

### 1.3. شهادة SSL

استخدم Let's Encrypt:

```bash
# تثبيت certbot
sudo apt install certbot

# توليد شهادة
sudo certbot certonly --standalone \
  -d api.yourdomain.com \
  -d app.yourdomain.com \
  --agree-tos --no-eff-email

# نسخ الشهادة إلى مجلد nginx المتوقع
sudo mkdir -p nginx/ssl
sudo cp /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/api.yourdomain.com/privkey.pem nginx/ssl/
```

### 1.4. تجهيز Nginx

راجع `nginx/conf.d/default.conf` وعدّل النطاق.

## 2. النشر

### 2.1. بناء الصور

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build
```

### 2.2. تشغيل الخدمات

```bash
# تشغيل في الخلفية
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# التحقق من الحالة
docker compose -f docker-compose.prod.yml ps
```

### 2.3. تنفيذ Migrations

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec backend npx prisma migrate deploy
```

### 2.4. فحص الصحة

```bash
# Backend health
curl https://api.yourdomain.com/health

# Frontend
curl -I https://app.yourdomain.com

# Health شامل
curl https://api.yourdomain.com/health/ready
```

## 3. المراقبة

### 3.1. السجلات

```bash
# سجلات حية
docker compose -f docker-compose.prod.yml logs -f

# سجل خدمة محددة
docker compose -f docker-compose.prod.yml logs -f backend

# سجل آخر 100 سطر
docker compose -f docker-compose.prod.yml logs --tail=100 backend
```

### 3.2. الإحصائيات

```bash
# استهلاك الموارد
docker stats

# مساحة القرص
df -h

# استخدام الذاكرة
free -h
```

## 4. التحديث

```bash
# 1. سحب آخر التحديثات
git pull origin main

# 2. نسخ احتياطي قبل التحديث
./scripts/backup.sh

# 3. بناء صور جديدة
docker compose -f docker-compose.prod.yml --env-file .env.prod build

# 4. تشغيل migrations أولاً
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm backend npx prisma migrate deploy

# 5. إعادة تشغيل الخدمات
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate

# 6. فحص
docker compose -f docker-compose.prod.yml ps
curl https://api.yourdomain.com/health
```

## 5. التراجع

```bash
# استعادة الإصدار السابق
git checkout v1.2.1

docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate
```

## 6. التحجيم الأفقي

لزيادة عدد الـbackend instances، استخدم reverse proxy مثل Nginx أو HAProxy.

## 7. CI/CD

راجع `.github/workflows/` للنشر التلقائي (إن وُجد).

## 8. جهات اتصال الدعم

- **Email**: support@albinaa.com
- **GitHub Issues**: https://github.com/737337877h-ux/albinaa-platform2/issues
- **Documentation**: [docs/](./docs/)

## 9. النسخ الاحتياطي والاستعادة

- ينفّذ خادم `backup` نسخة PostgreSQL فيزيائية كاملة يوميًا الساعة 02:00.
- يجمع ملفات WAL التفاضلية كل ساعة عند الدقيقة 05، مع احتفاظ افتراضي لمدة 7 أيام.
- ينفّذ اختبار استعادة معزولًا في اليوم الأول من كل شهر الساعة 04:00، ويحفظ تقرير JSON في `/backups/restore-tests`.
- مدة الاحتفاظ بالنسخ الكاملة يضبطها `BACKUP_RETENTION_DAYS`، ومدة الفروقات يضبطها `DIFF_RETENTION_DAYS`.

تشغيل تحقق يدوي آمن داخل حاوية النسخ:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backup \
  /bin/sh /usr/local/bin/backup-runner.sh full
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backup \
  /bin/sh /usr/local/bin/backup-runner.sh differential
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backup \
  /bin/sh /usr/local/bin/restore-test.sh
```

ينبغي نسخ مجلد/وحدة `albinaa_backups` إلى تخزين خارجي مشفّر؛ وجود النسخة على الخادم نفسه لا يكفي للتعافي من فقد الخادم.

## 10. فحص الجاهزية والمراقبة

قبل تشغيل الإنتاج، افحص ملف البيئة المحلي الذي لا يُرفع إلى Git:

```bash
node scripts/validate-production-env.mjs .env.prod
```

يفشل الفحص عند بقاء قيم تجريبية، أو قصر الأسرار، أو تكرار أسرار JWT، أو استخدام HTTP/CORS غير آمن. ولتفعيل المراقبة الدورية، عيّن متغير مستودع GitHub باسم `PRODUCTION_HEALTH_URL` إلى أصل واجهة API المشفر مثل `https://api.company.example`. يفحص workflow مساري `/health` و`/health/ready` كل 15 دقيقة، وتظهر إخفاقاته في GitHub Actions والتنبيهات المرتبطة بالمستودع.
