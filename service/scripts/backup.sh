#!/usr/bin/env bash
set -euo pipefail

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but was not found on PATH" >&2
  exit 1
fi

: "${DATABASE_URL:=}"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL environment variable is required" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "${BACKUP_DIR}"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
filename="architect_${timestamp}.dump"
filepath="${BACKUP_DIR}/${filename}"

pg_dump --no-owner --format=custom --file="${filepath}" "${DATABASE_URL}"

find "${BACKUP_DIR}" -type f -name "architect_*.dump" -mtime +"${RETENTION_DAYS}" -delete

echo "Backup written to ${filepath}"
