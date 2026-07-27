#!/bin/sh
set -e
echo "تطبيق الـ Migrations..."
npx prisma migrate deploy --schema=./prisma/schema.prisma
echo "تشغيل الـ Backend..."
exec node dist/main.js
