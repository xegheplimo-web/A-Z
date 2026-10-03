#Requires -Version 5.1
<#
.SYNOPSIS
  VietScope - one-command setup for a fresh machine (Windows).
.DESCRIPTION
  - Verifies prerequisites: Node.js >= 22, npm, git. Optional: Docker, uv.
  - Copies .env.example to .env (never overwrites an existing file).
  - Runs npm ci against the committed package-lock.json.
  - Default (embedded dev): starts Postgres via docker compose, pushes the
    drizzle schema and seeds the reference dataset.
  - -Production: boots the full retrieval stack (PostGIS, Redis, OpenSearch,
    Qdrant, SearXNG, search-router, facade) via the production overlay.
  - Syncs the Python core venv with uv sync --frozen when uv is available.
.EXAMPLE
  .\scripts\setup.ps1
  .\scripts\setup.ps1 -SkipPython
  .\scripts\setup.ps1 -Production
#>
[CmdletBinding()]
param(
  [switch]$SkipDocker,
  [switch]$SkipPython,
  [switch]$Production
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [fail] $m" -ForegroundColor Red; exit 1 }
function Test-Cmd($name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

function Get-DotEnvValue([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ($v) { return $v }
  if (Test-Path .env) {
    foreach ($line in Get-Content .env) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $k, $val = $line -split '=', 2
      if ($k.Trim() -eq $Name) { return $val.Trim().Trim('"').Trim("'") }
    }
  }
  return $null
}

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect($HostName, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { $c.Close(); return $false }
    $c.EndConnect($iar); $c.Close(); return $true
  } catch { return $false }
}

function Get-DbHostPort([string]$Url) {
  if ($Url -match 'postgres(?:ql)?://(?:[^:@/]+(?::[^@/]*)?@)?([^:/@?]+)(?::(\d+))?/') {
    $p = 5432; if ($Matches[2]) { $p = [int]$Matches[2] }
    return @($Matches[1], $p)
  }
  return $null
}

function Wait-PgReady([int]$Seconds = 60) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    docker compose exec -T db pg_isready -U postgres -d app_db *> $null
    if ($LASTEXITCODE -eq 0) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

# ---------------------------------------------------------------- prereqs ---
Info "Checking prerequisites"
if (Test-Cmd node) {
  $nodeMajor = [int]((node --version) -replace '^v', '' -split '\.')[0]
  if ($nodeMajor -lt 22) { Die "Node.js >= 22 required, found $(node --version). Install: https://nodejs.org" }
  Ok "node $(node --version)"
} else { Die "Node.js >= 22 required. Install: https://nodejs.org" }

if (Test-Cmd npm) { Ok "npm $(npm --version)" } else { Die "npm not found (comes with Node.js)" }
if (Test-Cmd git) { Ok "git $(git --version)" } else { Warn "git not found - only needed to clone/update" }

$hasDocker = $false
if (-not $SkipDocker -and (Test-Cmd docker)) {
  docker ps *> $null
  if ($LASTEXITCODE -eq 0) { $hasDocker = $true; Ok "docker $(docker --version)" }
  else { Warn "docker CLI found but daemon is not reachable - skipping Docker steps" }
} elseif (-not $SkipDocker) { Warn "docker not found - skipping container steps" }

$hasUv = Test-Cmd uv
if ($hasUv) { Ok "uv $(uv --version)" } else { Warn "uv not found - Python core sync will be skipped (optional for embedded mode). Install: https://docs.astral.sh/uv/" }

# ------------------------------------------------------------------- .env ---
Info "Environment file"
if (Test-Path .env) { Ok ".env already exists - left untouched" }
else {
  Copy-Item .env.example .env
  Ok "created .env from .env.example - review it before production use"
}

# ----------------------------------------------------------------- npm ci ---
Info "Installing Node.js dependencies (npm ci)"
npm ci
if ($LASTEXITCODE -ne 0) { Die "npm ci failed" }
Ok "node_modules installed from package-lock.json"

# ------------------------------------------------------------------ modes ---
if ($Production) {
  if (-not $hasDocker) { Die "-Production requires a running Docker daemon" }
  Info "Starting the full production retrieval stack (compose overlay)"
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile production up -d --build --wait
  if ($LASTEXITCODE -ne 0) { Die "production compose stack failed to become healthy" }
  Ok "stack is up: facade http://localhost:3000 | core http://127.0.0.1:8888"
} else {
  Info "Facade database (embedded dev/reference mode)"
  $dbReady = $false
  if ($hasDocker) {
    docker compose up -d db
    if ($LASTEXITCODE -ne 0) { Die "docker compose up -d db failed" }
    $dbReady = Wait-PgReady 60
    if (-not $dbReady) { Die "Postgres container did not become ready in 60s" }
    Ok "postgres:16 container healthy (localhost:5432)"
  } else {
    $dbUrl = Get-DotEnvValue 'DATABASE_URL'
    $hp = Get-DbHostPort $dbUrl
    if ($hp -and (Test-TcpPort $hp[0] $hp[1])) {
      $dbReady = $true
      Ok "reusing existing Postgres at $($hp[0]):$($hp[1])"
    } else {
      Warn "no Docker and DATABASE_URL ($dbUrl) is not reachable - schema push/seed skipped."
      Warn "install Postgres or Docker, then run: npx drizzle-kit push; npx tsx src/db/seed.ts"
    }
  }
  if ($dbReady) {
    npx drizzle-kit push
    if ($LASTEXITCODE -ne 0) { Die "drizzle-kit push failed" }
    Ok "facade schema pushed"
    npx tsx src/db/seed.ts
    if ($LASTEXITCODE -ne 0) { Die "seed failed" }
    Ok "embedded reference dataset seeded"
  }
}

# ------------------------------------------------------------- python core ---
if (-not $SkipPython) {
  if ($hasUv) {
    Info "Syncing Python search-router core (uv sync --frozen)"
    Push-Location services/search-router
    try {
      uv sync --frozen
      if ($LASTEXITCODE -ne 0) { Die "uv sync --frozen failed" }
      Ok "services/search-router/.venv ready"
    } finally { Pop-Location }
  } else {
    Warn "skipped Python core sync (uv missing). The facade runs without it; the production brain needs it outside Docker."
  }
}

# ---------------------------------------------------------------- summary ---
Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
if ($Production) {
  Write-Host "  Stack   : docker compose -f docker-compose.yml -f docker-compose.production.yml --profile production ps"
  Write-Host "  Facade  : http://localhost:3000/api/health"
  Write-Host "  Core    : http://127.0.0.1:8888/v1/health"
  Write-Host "  Verify  : SEARCH_ROUTER_URL=http://127.0.0.1:8888 npm run test:conformance:production"
} else {
  Write-Host "  Start   : .\scripts\start.ps1          (or: .\scripts\start.ps1 -Dev)"
  Write-Host "  Verify  : .\scripts\verify.ps1"
  Write-Host "  App     : http://localhost:3000"
}
