param([Parameter(Mandatory)][ValidateSet('start', 'stop', 'status')][string]$Action)

# Supports the documented portable layout and the standard Windows installer layout.
$portableHome = Join-Path $env:USERPROFILE 'pg-chakravaat'
$installedHomes = @(Get-ChildItem (Join-Path $env:ProgramFiles 'PostgreSQL') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | ForEach-Object { $_.FullName })
$pgHome = if ($env:PG_HOME) {
    $env:PG_HOME
} elseif (Test-Path (Join-Path $portableHome 'pgsql\bin\pg_ctl.exe')) {
    $portableHome
} elseif ($installedHomes) {
    $installedHomes[0]
} else {
    $portableHome
}
$bin = if (Test-Path (Join-Path $pgHome 'pgsql\bin\pg_ctl.exe')) {
    Join-Path $pgHome 'pgsql\bin'
} else {
    Join-Path $pgHome 'bin'
}
$data = if (Test-Path (Join-Path $pgHome 'pgsql\data')) {
    Join-Path $pgHome 'pgsql\data'
} else {
    Join-Path $pgHome 'data'
}
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$port = 5433

switch ($Action) {
    'start' {
        if (-not (Test-Path -LiteralPath $pgCtl -PathType Leaf)) {
            Write-Error "PostgreSQL was not found at $pgCtl. Download and unzip PostgreSQL into $pgHome, or set PG_HOME to its install folder. See RUNNING.txt, section 3."
            exit 1
        }
        if (-not (Test-Path -LiteralPath $data -PathType Container)) {
            Write-Error "PostgreSQL data directory was not found at $data. Initialize it once with: `"$bin\initdb.exe`" -D `"$data`" -U postgres --auth=trust --encoding=UTF8 --locale=C"
            exit 1
        }
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "PostgreSQL already running on :$port"
            break
        }
        # Detached (own hidden window) so the database keeps running after this shell exits.
        $startArgs = "-D `"$data`" -o `"-p $port -c listen_addresses=127.0.0.1`" -l `"$(Join-Path $pgHome 'postgres.log')`" start"
        Start-Process -FilePath $pgCtl -ArgumentList $startArgs -WindowStyle Hidden
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
    'stop'   { & $pgCtl -D $data -m fast stop }
    'status' { & $pgCtl -D $data status }
}
