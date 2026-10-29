#!/bin/sh
# ============================================================================
# منصة البناء الراقي — Restore Database from Backup
# الاستخدام: ./scripts/restore.sh /backups/albinaa_20260728_020000.sql.gz
# ============================================================================
set -e

BACKUP_FILE="$1"
DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-albinaa}"
DB_NAME="${DB_NAME:-albinaa}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 <backup-file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lh /backups/albinaa_*.sql.gz 2>/dev/null || echo "  (none found)"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: File not found: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "⚠️  WARNING: This will REPLACE all data in database '${DB_NAME}'!"
echo "   Backup file: ${BACKUP_FILE}"
echo "   Size: $(du -h "${BACKUP_FILE}" | cut -f1)"
echo ""
read -p "Type 'RESTORE' to confirm: " CONFIRM
if [ "${CONFIRM}" != "RESTORE" ]; then
  echo "Aborted."
  exit 1
fi

echo "[$(date -Iseconds)] Dropping and recreating database..."
psql -h "${DB_HOST}" -U "${DB_USER}" -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
" 2>/dev/null || true
psql -h "${DB_HOST}" -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"
psql -h "${DB_HOST}" -U "${DB_USER}" -d postgres -c "CREATE DATABASE ${DB_NAME};"

echo "[$(date -Iseconds)] Restoring from backup..."
gunzip -c "${BACKUP_FILE}" | pg_restore -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-privileges --exit-on-error 2>&1

echo "[$(date -Iseconds)] Running migrations..."
# Note: prisma migrate deploy should be run after restore

echo "✅ Restore complete!"
echo "   Run: npx prisma migrate deploy --schema=../prisma/schema.prisma"
