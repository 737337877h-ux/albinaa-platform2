#!/bin/sh
# ============================================================================
# منصة البناء الراقي — Daily Database Backup
# يُشغّل كـ cron job داخل حاوية backup
# ============================================================================
set -e

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/albinaa_${TIMESTAMP}.sql.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

echo "[$(date -Iseconds)] Starting backup of ${POSTGRES_DB}..."

# ── Backup with compression ──────────────────────────────────
pg_dump \
  -h db \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --format=custom \
  --compress=9 \
  --verbose \
  2>/dev/null | gzip > "${BACKUP_FILE}"

FILESIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: ${BACKUP_FILE} (${FILESIZE})"

# ── Verify backup integrity ──────────────────────────────────
gunzip -t "${BACKUP_FILE}" 2>/dev/null
if [ $? -eq 0 ]; then
  echo "[$(date -Iseconds)] Verification passed"
else
  echo "[$(date -Iseconds)] ERROR: Backup verification failed!" >&2
  exit 1
fi

# ── Retention: delete backups older than N days ───────────────
DELETED=$(find "${BACKUP_DIR}" -name "albinaa_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "[$(date -Iseconds)] Retention: deleted ${DELETED} backups older than ${RETENTION_DAYS} days"

# ── List current backups ──────────────────────────────────────
echo "[$(date -Iseconds)] Current backups:"
ls -lh "${BACKUP_DIR}"/albinaa_*.sql.gz 2>/dev/null || echo "  (none)"

echo "[$(date -Iseconds)] Backup job finished"
