# Backup & Restore — BrandForge AI (Oracle)

Two things need backing up: **Postgres** (all business data) and the **storage
volume** (uploaded/generated assets under `STORAGE_PATH`). Everything else (code,
nginx vhost) is in git or trivially recreated.

> Naming used below: compose project at `~/apps/brandforge`, service name
> `postgres`, volume `pgdata`. Adjust if `infrastructure/docker/docker-compose.yml`
> names them differently.

## Automated production backup

Production uses the committed `infrastructure/backup/backup.sh` script. It creates an
atomic PostgreSQL dump and an asset-volume snapshot together, validates both gzip
streams, writes SHA-256 checksums and only then applies retention (14 days for the
database, 30 days for assets).

The Oracle crontab runs it every day at 03:15 Europe/Madrid:

```bash
15 3 * * * /home/ubuntu/apps/brandforge/infrastructure/backup/backup.sh >> /home/ubuntu/backups/brandforge/cron.log 2>&1
```

The sections below document the underlying manual procedure and restore steps.

## 1. Postgres — nightly pg_dump via cron

**Purpose:** a compressed logical dump, kept 14 days locally (+ optionally copied
off-site).

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: create the backup script (runs pg_dump inside the postgres container).
mkdir -p ~/backups/brandforge
cat > ~/backups/brandforge/pg-backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail
cd ~/apps/brandforge
STAMP=$(date +%F-%H%M)
OUT=~/backups/brandforge/brandforge-$STAMP.sql.gz
docker compose -f infrastructure/docker/docker-compose.yml exec -T postgres \
  pg_dump -U brandforge -d brandforge | gzip > "$OUT"
# retention: keep 14 days
find ~/backups/brandforge -name 'brandforge-*.sql.gz' -mtime +14 -delete
echo "OK $OUT ($(du -h "$OUT" | cut -f1))"
EOF
chmod +x ~/backups/brandforge/pg-backup.sh
~/backups/brandforge/pg-backup.sh   # test run now
```

**Purpose:** schedule it every night at 03:00:

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: add the nightly cron job.
(crontab -l 2>/dev/null; echo "0 3 * * * /home/ubuntu/backups/brandforge/pg-backup.sh >> /home/ubuntu/backups/brandforge/cron.log 2>&1") | crontab -
crontab -l | grep brandforge
```

## 2. Storage volume — tar snapshot

**Purpose:** back up uploaded/generated files (the DB only stores their paths).

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: tar the storage volume (weekly is usually enough).
cat > ~/backups/brandforge/storage-backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail
STAMP=$(date +%F)
OUT=~/backups/brandforge/storage-$STAMP.tar.gz
# run from a throwaway container mounting the same named volume
docker run --rm -v brandforge_storage:/data -v ~/backups/brandforge:/backup \
  ubuntu:24.04 tar -czf /backup/storage-$STAMP.tar.gz -C /data .
find ~/backups/brandforge -name 'storage-*.tar.gz' -mtime +30 -delete
echo "OK $OUT"
EOF
chmod +x ~/backups/brandforge/storage-backup.sh
# Weekly on Sundays at 03:30:
(crontab -l 2>/dev/null; echo "30 3 * * 0 /home/ubuntu/backups/brandforge/storage-backup.sh >> /home/ubuntu/backups/brandforge/cron.log 2>&1") | crontab -
```

> Replace `brandforge_storage` with the real volume name (`docker volume ls`).
> Off-site copy (recommended): `rclone`/`rsync` `~/backups/brandforge/` to your PC
> or object storage after the dump.

## 3. Restore

**Purpose:** bring the DB back from a dump (e.g. after a bad migration).

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: restore a pg_dump into the postgres container.
cd ~/apps/brandforge
DUMP=~/backups/brandforge/brandforge-<FECHA>.sql.gz
# 1. stop the app tier (keep postgres up)
docker compose -f infrastructure/docker/docker-compose.yml stop api worker
# 2. drop + recreate the database, then restore
docker compose -f infrastructure/docker/docker-compose.yml exec -T postgres \
  psql -U brandforge -d postgres -c "DROP DATABASE brandforge;"
docker compose -f infrastructure/docker/docker-compose.yml exec -T postgres \
  psql -U brandforge -d postgres -c "CREATE DATABASE brandforge;"
zcat "$DUMP" | docker compose -f infrastructure/docker/docker-compose.yml exec -T postgres \
  psql -U brandforge -d brandforge
# 3. start the app tier again
docker compose -f infrastructure/docker/docker-compose.yml start api worker
```

**Storage restore:**

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: restore the storage volume from a tar snapshot.
docker run --rm -v brandforge_storage:/data -v ~/backups/brandforge:/backup \
  ubuntu:24.04 bash -c "rm -rf /data/* && tar -xzf /backup/storage-<FECHA>.tar.gz -C /data"
```

## 4. Retention suggestion

| What | Frequency | Keep | Where |
|---|---|---|---|
| Postgres dump (`.sql.gz`) | daily 03:00 | 14 days | `~/backups/brandforge/` + off-site copy |
| Storage tar | weekly (Sun 03:30) | 30 days | same |
| Pre-deploy manual dump | before every `db:migrate` in prod | until next deploy succeeds | same |

Test the restore on a scratch database at least once — an untested backup is not
a backup.
