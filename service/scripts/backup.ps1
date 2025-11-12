Param(
    [string]$OutputDir = $env:BACKUP_DIR,
    [int]$RetentionDays = $(if ($env:RETENTION_DAYS) { [int]$env:RETENTION_DAYS } else { 14 })
)

$databaseUrl = $env:DATABASE_URL
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
    Write-Error "DATABASE_URL environment variable is required."
    exit 1
}

if (-not $OutputDir) {
    $OutputDir = Join-Path (Get-Location) "backups"
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    Write-Error "pg_dump is required but was not found on PATH."
    exit 1
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$filename = "architect_$timestamp.dump"
$filepath = Join-Path $OutputDir $filename

& $pgDump.Source --no-owner --format=custom --file=$filepath "--dbname=$databaseUrl"
if ($LASTEXITCODE -ne 0) {
    Remove-Item -Path $filepath -ErrorAction SilentlyContinue
    throw "pg_dump failed with exit code $LASTEXITCODE"
}

Get-ChildItem -Path $OutputDir -Filter "architect_*.dump" |
    Where-Object { $_.CreationTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-$RetentionDays) } |
    Remove-Item -Force

Write-Host "Backup written to $filepath"
