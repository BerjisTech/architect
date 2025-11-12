# Architect Service Backup Strategy

The architect backend stores all state in PostgreSQL. Backups are taken using `pg_dump` in the custom (`-Fc`) format so they can be restored with `pg_restore`. This service follows the platform guidance in `docs/infra/backup-jobs.md` and adds project-specific scripts for local and CI usage.

## Running a Manual Backup

1. Ensure `pg_dump` is installed (it ships with the PostgreSQL client tools).
2. Export the same `DATABASE_URL` value used by the service.
3. Run either script from the service root:

```bash
# bash
DATABASE_URL=postgres://postgres:postgres@localhost:5444/berjis_architect?sslmode=disable \
./scripts/backup.sh
```

```powershell
# PowerShell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5444/berjis_architect?sslmode=disable"
./scripts/backup.ps1
```

Backups are written to `./backups` (configurable via `BACKUP_DIR`) and include a UTC timestamp in the filename. Files older than the retention window (default 14 days, configurable via `RETENTION_DAYS`) are pruned after each run.

## Automation

- **Local docker-compose**: include the `pg-backup` sidecar described in `docs/infra/backup-jobs.md`, mounting this service directory so the backup scripts and retention policy are reused.
- **Production**: schedule the Bash script via cron/kubernetes job with the following environment:
  - `DATABASE_URL` – connection string for the primary writer instance.
  - `BACKUP_DIR` – mount path for durable storage (object storage or persistent volume).
  - `RETENTION_DAYS` – days to keep local files before pruning.
- Ship completed dumps to object storage (S3, GCS, etc.) using an existing sync job (`rclone`, `aws s3 sync`, etc.) for off-site redundancy.

## Restore Procedure

1. Provision a fresh database (see `/docs/infra/slim-db.md` for initialization).
2. Download the desired dump file.
3. Run `pg_restore -c -d berjis_architect --single-transaction <dump file>` to recreate schema and data.
4. Run service migrations (`cmd/service/main.go` or `go run ./cmd/service`) to ensure the schema is up to date.
