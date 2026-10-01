param(
    [switch]$NoBrowser,
    [int]$ExitAfter = 0   # seconds; 0 = run until Ctrl+C (non-zero is for smoke tests)
)

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$pgHome = if ($env:PG_HOME) { $env:PG_HOME } else { Join-Path $env:USERPROFILE 'pg-chakravaat' }
$pgBin  = Join-Path $pgHome 'pgsql\bin'
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
$apiPort = 8000
$webPort = 8080
$dbPort  = 5433

function Test-Port($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Port($port, $seconds) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-Port $port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Stop-Tree($proc) {
    if ($proc -and -not $proc.HasExited) { taskkill /T /F /PID $proc.Id | Out-Null }
}

if (-not (Test-Path $python)) {
    throw "Backend virtualenv not found at $python. Set it up first (see RUNNING.txt, section 1)."
}
foreach ($p in $apiPort, $webPort) {
    if (Test-Port $p) { throw "Port $p is already in use. Stop whatever is using it and retry." }
}

$api = $null
$web = $null
$startedDb = $false

try {
    # 1. Database (only if configured and installed; otherwise the API serves its JSON seed data)
    if ((Test-Path (Join-Path $root 'backend\.env')) -and (Test-Path $pgBin)) {
        if (Test-Port $dbPort) {
            Write-Host "[db]  already running on :$dbPort"
        } else {
            Write-Host "[db]  starting PostgreSQL on :$dbPort ..."
            $dbArgs = "-D `"$pgHome\data`" -o `"-p $dbPort -c listen_addresses=127.0.0.1`" -l `"$pgHome\postgres.log`" start"
            Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList $dbArgs -WindowStyle Hidden
            if (-not (Wait-Port $dbPort 30)) { throw "PostgreSQL did not come up; see $pgHome\postgres.log" }
            $startedDb = $true
        }
    } else {
        Write-Host "[db]  not configured - the API will serve JSON seed data"
    }

    # 2. Backend API
    Write-Host "[api] starting FastAPI on :$apiPort ..."
    $api = Start-Process -FilePath $python -ArgumentList "-m uvicorn app.main:app --port $apiPort" `
        -WorkingDirectory (Join-Path $root 'backend') -NoNewWindow -PassThru
    if (-not (Wait-Port $apiPort 30)) { throw "API did not start on :$apiPort" }

    # 3. Frontend
    Write-Host "[web] starting frontend on :$webPort ..."
    $web = Start-Process -FilePath 'node' -ArgumentList "`"$(Join-Path $root 'scripts\serve.js')`" `"$root`" $webPort" `
        -NoNewWindow -PassThru
    if (-not (Wait-Port $webPort 15)) { throw "Frontend did not start on :$webPort" }

    Write-Host ""
    Write-Host "  App:       http://localhost:$webPort"
    Write-Host "  API docs:  http://127.0.0.1:$apiPort/docs"
    Write-Host "  Press Ctrl+C to stop everything."
    Write-Host ""

    if (-not $NoBrowser) { Start-Process "http://localhost:$webPort" }

    $deadline = if ($ExitAfter -gt 0) { (Get-Date).AddSeconds($ExitAfter) } else { [datetime]::MaxValue }
    while (-not $api.HasExited -and -not $web.HasExited -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host ""
    Write-Host "Shutting down ..."
    Stop-Tree $web
    Stop-Tree $api
    if ($startedDb) {
        & (Join-Path $pgBin 'pg_ctl.exe') -D (Join-Path $pgHome 'data') -m fast stop | Out-Null
        Write-Host "[db]  stopped"
    }
}
