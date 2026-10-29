#!/bin/sh
# Restores the latest physical full backup into an isolated temporary cluster.
set -eu

BACKUP_ROOT="${BACKUP_DIR:-/backups}"
DB_NAME="${POSTGRES_DB:-albinaa}"
PORT="${RESTORE_TEST_PORT:-55432}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
LATEST="$(find "${BACKUP_ROOT}/full" -name 'albinaa_full_*.tar.gz' -type f | sort | tail -n 1)"
WORK_DIR="${BACKUP_ROOT}/.restore-test-${TIMESTAMP}"
REPORT_DIR="${BACKUP_ROOT}/restore-tests"
LOG_FILE="${WORK_DIR}/postgres.log"
STARTED=0

[ -n "${LATEST}" ] || { echo "ERROR: No full backup is available." >&2; exit 1; }
mkdir -p "${WORK_DIR}/socket" "${REPORT_DIR}"
trap 'if [ "${STARTED}" = 1 ]; then su-exec postgres pg_ctl -D "${WORK_DIR}/cluster" -m fast stop >/dev/null 2>&1 || true; fi; rm -rf "${WORK_DIR}"' EXIT INT TERM

sha256sum -c "${LATEST}.sha256"
tar -xzf "${LATEST}" -C "${WORK_DIR}"
chmod 700 "${WORK_DIR}/cluster"
chown -R postgres:postgres "${WORK_DIR}"
su-exec postgres pg_ctl -D "${WORK_DIR}/cluster" \
  -o "-p ${PORT} -c listen_addresses='' -c unix_socket_directories='${WORK_DIR}/socket' -c archive_mode=off" \
  -l "${LOG_FILE}" start >/dev/null
STARTED=1

READY=0
for _ in $(seq 1 30); do
  if pg_isready -h "${WORK_DIR}/socket" -p "${PORT}" -d "${DB_NAME}" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "${READY}" = 1 ] || { echo "ERROR: Restored database did not become ready." >&2; exit 1; }

TABLE_COUNT="$(psql -h "${WORK_DIR}/socket" -p "${PORT}" -U "${POSTGRES_USER:-albinaa}" -d "${DB_NAME}" --tuples-only --no-align --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")"
MIGRATION_COUNT="$(psql -h "${WORK_DIR}/socket" -p "${PORT}" -U "${POSTGRES_USER:-albinaa}" -d "${DB_NAME}" --tuples-only --no-align --command='SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')"
[ "${TABLE_COUNT}" -gt 0 ] && [ "${MIGRATION_COUNT}" -gt 0 ]

DIFF_COUNT="$(find "${BACKUP_ROOT}/differential" -name 'albinaa_diff_*.tar.gz' -type f | wc -l | tr -d ' ')"
for DIFF in "${BACKUP_ROOT}"/differential/albinaa_diff_*.tar.gz; do
  [ -e "${DIFF}" ] || continue
  sha256sum -c "${DIFF}.sha256" >/dev/null
  tar -tzf "${DIFF}" >/dev/null
done

REPORT="${REPORT_DIR}/restore_${TIMESTAMP}.json"
printf '{"status":"passed","testedAt":"%s","fullBackup":"%s","differentialArchivesVerified":%s,"publicTables":%s,"appliedMigrations":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "${LATEST}")" "${DIFF_COUNT}" "${TABLE_COUNT}" "${MIGRATION_COUNT}" > "${REPORT}"
echo "[$(date -Iseconds)] Restore test passed: ${REPORT}"

