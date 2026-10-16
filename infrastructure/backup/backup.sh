#!/bin/sh
set -eu

REPO_DIR="/home/ubuntu/apps/brandforge"
BACKUP_DIR="/home/ubuntu/backups/brandforge"
COMPOSE_FILE="infrastructure/docker/docker-compose.yml"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
DB_NAME="brandforge-db-${STAMP}.sql.gz"
STORAGE_NAME="brandforge-storage-${STAMP}.tar.gz"
DB_TMP="${BACKUP_DIR}/.${DB_NAME}.tmp"
STORAGE_TMP="${BACKUP_DIR}/.${STORAGE_NAME}.tmp"

cleanup() {
  rm -f -- "$DB_TMP" "$STORAGE_TMP"
}
trap cleanup EXIT INT TERM

mkdir -p -- "$BACKUP_DIR"
cd "$REPO_DIR"

STORAGE_VOLUME="$(docker volume ls \
  --filter label=com.docker.compose.project=docker \
  --filter label=com.docker.compose.volume=bf_storage \
  --format '{{.Name}}')"

if [ -z "$STORAGE_VOLUME" ] || [ "$(printf '%s\n' "$STORAGE_VOLUME" | wc -l)" -ne 1 ]; then
  echo "ERROR: expected exactly one BrandForge storage volume" >&2
  exit 1
fi

docker compose --env-file .env -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 > "$DB_TMP"
gzip -t "$DB_TMP"
test -s "$DB_TMP"
mv -- "$DB_TMP" "$BACKUP_DIR/$DB_NAME"

docker run --rm \
  -v "$STORAGE_VOLUME:/data:ro" \
  -v "$BACKUP_DIR:/backup" \
  alpine:3.20 \
  tar -czf "/backup/.${STORAGE_NAME}.tmp" -C /data .
gzip -t "$STORAGE_TMP"
test -s "$STORAGE_TMP"
mv -- "$STORAGE_TMP" "$BACKUP_DIR/$STORAGE_NAME"

sha256sum "$BACKUP_DIR/$DB_NAME" "$BACKUP_DIR/$STORAGE_NAME" > "$BACKUP_DIR/brandforge-${STAMP}.sha256"

# This directory is deliberately fixed and narrow. Never broaden these paths.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'brandforge-db-*.sql.gz' -mtime +14 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'brandforge-storage-*.tar.gz' -mtime +30 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'brandforge-*.sha256' -mtime +30 -delete

printf 'OK database=%s storage=%s checksum=%s\n' \
  "$DB_NAME" "$STORAGE_NAME" "brandforge-${STAMP}.sha256"
