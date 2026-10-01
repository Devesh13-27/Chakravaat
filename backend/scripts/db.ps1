param([Parameter(Mandatory)][ValidateSet('start', 'stop', 'status')][string]$Action)

# Portable PostgreSQL 17 + PostGIS lives outside the repo (see RUNNING.txt -> Database).
$pgHome = if ($env:PG_HOME) { $env:PG_HOME } else { Join-Path $env:USERPROFILE 'pg-chakravaat' }
$bin = Join-Path $pgHome 'pgsql\bin'
$data = Join-Path $pgHome 'data'
$port = 5433

switch ($Action) {
    'start' {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "PostgreSQL already running on :$port"
            break
        }
        # Detached (own hidden window) so the database keeps running after this shell exits.
        $startArgs = "-D `"$data`" -o `"-p $port -c listen_addresses=127.0.0.1`" -l `"$(Join-Path $pgHome 'postgres.log')`" start"
        Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $startArgs -WindowStyle Hidden
        for ($i = 0; $i -lt 30; $i++) {
            if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
                Write-Host "PostgreSQL started on :$port"
                return
            }
            Start-Sleep -Seconds 1
        }
        Write-Error "PostgreSQL did not start; see $(Join-Path $pgHome 'postgres.log')"
        exit 1
    }
    'stop'   { & "$bin\pg_ctl.exe" -D $data -m fast stop }
    'status' { & "$bin\pg_ctl.exe" -D $data status }
}
