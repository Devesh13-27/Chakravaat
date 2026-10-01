param([Parameter(Mandatory)][ValidateSet('start', 'stop', 'status')][string]$Action)

# Portable PostgreSQL 17 + PostGIS lives outside the repo (see README -> Database).
$pgHome = if ($env:PG_HOME) { $env:PG_HOME } else { Join-Path $env:USERPROFILE 'pg-chakravaat' }
$bin = Join-Path $pgHome 'pgsql\bin'
$data = Join-Path $pgHome 'data'

switch ($Action) {
    'start'  { & "$bin\pg_ctl.exe" -D $data -o '-p 5433 -c listen_addresses=127.0.0.1' -l (Join-Path $pgHome 'postgres.log') -w start }
    'stop'   { & "$bin\pg_ctl.exe" -D $data -m fast stop }
    'status' { & "$bin\pg_ctl.exe" -D $data status }
}
