# النسخ الاحتياطي والاستعادة

## النسخ الاحتياطي التلقائي

### التطوير (docker-compose.yml)
لا يوجد نسخ احتياطي تلقائي افتراضياً. شغّل يدوياً:
```bash
./scripts/backup.sh
```

### الإنتاج (docker-compose.prod.yml)
- حاوية `backup` تعمل تلقائياً كل يوم في الساعة 2:00 صباحاً
- تحتفظ بالنسخ لمدة 30 يوماً (قابل للضبط عبر `BACKUP_RETENTION_DAYS`)
- تُحفظ في volume `albinaa_backups` (في `/backups` داخل الحاوية)

## النسخ الاحتياطي اليدوي

```bash
# نسخ احتياطي كامل
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U $POSTGRES_USER -d $POSTGRES_DB | \
  gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# نسخ احتياطي للسجلات (اختياري)
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --schema-only | \
  gzip > schema_$(date +%Y%m%d).sql.gz

# نسخ ملفات المرفقات
docker run --rm \
  -v albinaa_uploads:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/uploads_$(date +%Y%m%d).tar.gz /data
```

## الاستعادة

### استعادة قاعدة البيانات

```bash
# 1. إيقاف الخدمات
docker compose -f docker-compose.prod.yml down

# 2. نسخ احتياطي للحالة الحالية (احتياطياً)
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U $POSTGRES_USER -d $POSTGRES_DB | \
  gzip > /tmp/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz

# 3. إسقاط وإنشاء قاعدة البيانات
docker compose -f docker-compose.prod.yml exec db \
  psql -U $POSTGRES_USER -d postgres -c "DROP DATABASE $POSTGRES_DB;"
docker compose -f docker-compose.prod.yml exec db \
  psql -U $POSTGRES_USER -d postgres -c "CREATE DATABASE $POSTGRES_DB;"

# 4. استعادة النسخة الاحتياطية
gunzip -c backup_20260730_020000.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db \
  psql -U $POSTGRES_USER -d $POSTGRES_DB

# 5. تشغيل migrations (احتياطياً)
docker compose -f docker-compose.prod.yml run --rm backend \
  npx prisma migrate deploy

# 6. إعادة تشغيل الخدمات
docker compose -f docker-compose.prod.yml up -d
```

### استعادة المرفقات

```bash
# إيقاف الـbackend أولاً
docker compose -f docker-compose.prod.yml stop backend

# استعادة
docker run --rm \
  -v albinaa_uploads:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/uploads_20260730.tar.gz --strip-components=1"

# إعادة تشغيل
docker compose -f docker-compose.prod.yml start backend
```

## جدول الاحتفاظ (Retention)

| البيئة | المدة | السبب |
|--------|-------|-------|
| Production | 30 يوم | متطلبات التدقيق |
| Staging | 7 أيام | تطوير |
| Development | 3 أيام | مساحة تخزين |

## النسخ الاحتياطي اليدوي قبل أي تعديل كبير

```bash
# قبل تشغيل migrations
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U $POSTGRES_USER -d $POSTGRES_DB | \
  gzip > pre_migration_$(date +%Y%m%d_%H%M%S).sql.gz
```

## اختبار الاستعادة

⚠️ **مهم جداً**: اختبر الاستعادة بشكل دوري!

```bash
# اختبار في بيئة منفصلة
docker compose -f docker-compose.test.yml up -d db

gunzip -c latest_backup.sql.gz | \
  docker compose -f docker-compose.test.yml exec -T db \
  psql -U albinaa -d albinaa

# التحقق
docker compose -f docker-compose.test.yml exec db \
  psql -U albinaa -d albinaa -c "SELECT COUNT(*) FROM customers;"
```

## النسخ الاحتياطي إلى موقع خارجي

### AWS S3
```bash
# تثبيت aws cli
apt install awscli

# نسخ احتياطي مباشر إلى S3
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U $POSTGRES_USER -d $POSTGRES_DB | \
  gzip | aws s3 cp - s3://my-backups/albinaa/db_$(date +%Y%m%d).sql.gz
```

### Backblaze B2
```bash
# تثبيت b2 CLI
pip install b2

# مثال: b2 upload-file ...
```

## استكشاف الأخطاء

### فشل النسخ الاحتياطي
```bash
# تحقق من حالة الـcontainer
docker compose -f docker-compose.prod.yml ps backup

# السجلات
docker compose -f docker-compose.prod.yml logs backup

# مساحة القرص
df -h
```

### فشل الاستعادة
```bash
# تحقق من سلامة الملف
gunzip -t backup.sql.gz

# تحقق من تنسيق الـdump
head -5 backup.sql
```
