#!/bin/sh
# Scheduled physical full backups and hourly WAL differential bundles.
set -eu

MODE="${1:-full}"
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-albinaa}"
DB_NAME="${POSTGRES_DB:-albinaa}"
BACKUP_ROOT="${BACKUP_DIR:-/backups}"
WAL_ROOT="${WAL_ARCHIVE_DIR:-/wal-archive}"
FULL_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DIFF_RETENTION_DAYS="${DIFF_RETENTION_DAYS:-7}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
LOCK_DIR="${BACKUP_ROOT}/.backup-lock"

mkdir -p "${BACKUP_ROOT}/full" "${BACKUP_ROOT}/differential" "${BACKUP_ROOT}/state" "${WAL_ROOT}"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "[$(date -Iseconds)] Another backup job is active; skipping ${MODE}."
  exit 0
fi
trap 'rm -rf "${LOCK_DIR}" "${WORK_DIR:-}"' EXIT INT TERM

export PGHOST="${DB_HOST}" PGPORT="${DB_PORT}" PGUSER="${DB_USER}" PGDATABASE="${DB_NAME}"

verify_server() {
  psql --no-password --tuples-only --command="SELECT 1" >/dev/null
}

run_full() {
  WORK_DIR="${BACKUP_ROOT}/.full-${TIMESTAMP}"
  ARCHIVE="${BACKUP_ROOT}/full/albinaa_full_${TIMESTAMP}.tar.gz"
  mkdir -p "${WORK_DIR}/cluster"
  echo "[$(date -Iseconds)] Starting physical full backup."
  pg_basebackup --no-password --checkpoint=fast --wal-method=stream --format=plain \
    --pgdata="${WORK_DIR}/cluster"
  printf '{"kind":"full","createdAt":"%s","database":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DB_NAME}" > "${WORK_DIR}/backup.json"
  tar -czf "${ARCHIVE}.tmp" -C "${WORK_DIR}" cluster backup.json
  tar -tzf "${ARCHIVE}.tmp" >/dev/null
  mv "${ARCHIVE}.tmp" "${ARCHIVE}"
  sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
  printf '%s\n' "${TIMESTAMP}" > "${BACKUP_ROOT}/state/last_full"
  echo "[$(date -Iseconds)] Full backup verified: ${ARCHIVE}"
}

run_differential() {
  WORK_DIR="${BACKUP_ROOT}/.differential-${TIMESTAMP}"
  ARCHIVE="${BACKUP_ROOT}/differential/albinaa_diff_${TIMESTAMP}.tar.gz"
  LAST_WAL="$(cat "${BACKUP_ROOT}/state/last_wal" 2>/dev/null || true)"
  mkdir -p "${WORK_DIR}/wal"

  ARCHIVE_MODE="$(psql --no-password --tuples-only --no-align --command='SHOW archive_mode')"
  if [ "${ARCHIVE_MODE}" != "on" ]; then
    echo "ERROR: PostgreSQL archive_mode must be enabled for differential backups." >&2
    exit 1
  fi
  psql --no-password --tuples-only --command='SELECT pg_switch_wal()' >/dev/null

  NEW_LAST="${LAST_WAL}"
  for WAL_PATH in $(find "${WAL_ROOT}" -maxdepth 1 -type f | sort); do
    WAL_NAME="$(basename "${WAL_PATH}")"
    case "${WAL_NAME}" in
      [0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]) ;;
      *) continue ;;
    esac
    if [ -z "${LAST_WAL}" ] || [ "${WAL_NAME}" \> "${LAST_WAL}" ]; then
      cp "${WAL_PATH}" "${WORK_DIR}/wal/${WAL_NAME}"
      NEW_LAST="${WAL_NAME}"
    fi
  done

  WAL_COUNT="$(find "${WORK_DIR}/wal" -type f | wc -l | tr -d ' ')"
  printf '{"kind":"differential-wal","createdAt":"%s","database":"%s","walFiles":%s,"previousWal":"%s","lastWal":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DB_NAME}" "${WAL_COUNT}" "${LAST_WAL}" "${NEW_LAST}" > "${WORK_DIR}/backup.json"
  tar -czf "${ARCHIVE}.tmp" -C "${WORK_DIR}" wal backup.json
  tar -tzf "${ARCHIVE}.tmp" >/dev/null
  mv "${ARCHIVE}.tmp" "${ARCHIVE}"
  sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
  [ -z "${NEW_LAST}" ] || printf '%s\n' "${NEW_LAST}" > "${BACKUP_ROOT}/state/last_wal"
  for ARCHIVED_WAL in "${WAL_ROOT}"/*; do
    [ -f "${ARCHIVED_WAL}" ] || continue
    WAL_NAME="$(basename "${ARCHIVED_WAL}")"
    case "${WAL_NAME}" in
      [0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]) ;;
      *) continue ;;
    esac
    if [ -n "${NEW_LAST}" ] && { [ "${WAL_NAME}" = "${NEW_LAST}" ] || [ "${WAL_NAME}" \< "${NEW_LAST}" ]; }; then
      rm -f "${ARCHIVED_WAL}"
    fi
  done
  echo "[$(date -Iseconds)] Differential backup verified: ${ARCHIVE} (${WAL_COUNT} WAL files)"
}

verify_server
case "${MODE}" in
  full) run_full ;;
  differential) run_differential ;;
  *) echo "Usage: $0 full|differential" >&2; exit 2 ;;
esac

find "${BACKUP_ROOT}/full" -type f -mtime "+${FULL_RETENTION_DAYS}" -delete
find "${BACKUP_ROOT}/differential" -type f -mtime "+${DIFF_RETENTION_DAYS}" -delete
