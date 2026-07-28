# النسخ الاحتياطي والاستعادة

## النسخ الاحتياطي التلقائي

النظام يشغّل نسخًا احتياطيًا تلقائيًا يوميًا الساعة 2:00 صباحًا عبر حاوية `backup` في `docker-compose.prod.yml`.

### الإعداد

```bash
# في .env.prod
BACKUP_RETENTION_DAYS=30   # الاحتفاظ بآخر 30 نسخة
```

### الموقع

النسخ تُحفظ في Docker Volume `albinaa_backups`:
```bash
# عرض النسخ
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups/
```

## النسخ اليدوي

```bash
# إنشاء نسخة احتياطية فورية
docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/backup.sh

# أو مباشرة من PostgreSQL
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U albinaa -d albinaa --format=custom --compress=9 | \
  gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

## الاستعادة

### من نسخة احتياطية

```bash
# 1. إيقاف Backend
docker compose -f docker-compose.prod.yml stop backend

# 2. استعادة البيانات
gunzip -c backup_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db \
  psql -U albinaa -d albinaa

# 3. تطبيق migrations
docker compose -f docker-compose.prod.yml exec backend \
  npx prisma migrate deploy

# 4. تشغيل Backend
docker compose -f docker-compose.prod.yml start backend
```

### باستخدام سكربت الاستعادة

```bash
docker compose -f docker-compose.prod.yml exec backup \
  /usr/local/bin/restore.sh /backups/albinaa_YYYYMMDD_HHMMSS.sql.gz
```

## التحقق من النسخة الاحتياطية

```bash
# فحص سلامة ملف gzip
gunzip -t backup_YYYYMMDD_HHMMSS.sql.gz

# فحص محتويات النسخة
gunzip -c backup_YYYYMMDD_HHMMSS.sql.gz | head -50
```

## سياسة الاحتفاظ

| البيئة | مدة الاحتفاظ | ملاحظات |
|--------|-------------|---------|
| Development | 7 أيام | |
| Staging | 14 يوم | |
| Production | 30 يوم | قابل للتعديل عبر `BACKUP_RETENTION_DAYS` |

## النسخ الاحتياطي خارج الخادم (مُوصى به)

```bash
# مزامنة مع S3 أو أي تخزين خارجي
aws s3 sync /backups s3://your-backup-bucket/albinaa/ --delete

# أو عبر rsync
rsync -avz /backups/ user@backup-server:/backups/albinaa/
```

## كوارث قصوى

1. أوقف جميع الخدمات
2. انسخ آخر نسخة احتياطية من التخزين الخارجي
3. استخدم سكربت الاستعادة
4. تحقق من البيانات
5. أعد تشغيل الخدمات

```bash
# إعادة بناء كاملة
docker compose -f docker-compose.prod.yml down -v  # ⚠️ يحذف كل شيء
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# ثم استعادة من النسخة الاحتياطية
```
