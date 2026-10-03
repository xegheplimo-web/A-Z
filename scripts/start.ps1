#Requires -Version 5.1
<#
.SYNOPSIS
  VietScope - start the facade (Windows).
.DESCRIPTION
  Default: ensures the dev Postgres container is up, builds .next when missing
  and serves the production build on http://localhost:<Port>.
  -Dev          : next dev (hot reload)
  -Production   : boot the full retrieval stack via the production overlay
  -SkipDocker   : do not touch the db container (use your own DATABASE_URL)
.EXAMPLE
  .\scripts\start.ps1
  .\scripts\start.ps1 -Dev
  .\scripts\start.ps1 -Production
#>
[CmdletBinding()]
param(
  [switch]$Dev,
  [switch]$Production,
  [switch]$SkipDocker,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [fail] $m" -ForegroundColor Red; exit 1 }
function Test-Cmd($name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

# Under EAP=Stop, redirecting a native command's stderr (*> $null) turns stderr
# lines into ErrorRecords that terminate the script. Run quiet native calls
# with EAP=Continue instead (function-scoped, reverts on return).
function Invoke-Quietly([scriptblock]$Block) {
  $ErrorActionPreference = 'Continue'
  & $Block *> $null
  return $LASTEXITCODE
}

if ($Production) {
  if (-not (Test-Cmd docker)) { Die "-Production requires Docker" }
  if ((Invoke-Quietly { docker ps }) -ne 0) { Die "Docker daemon is not running" }
  Info "Starting production retrieval stack"
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile production up -d --build --wait
  if ($LASTEXITCODE -ne 0) { Die "production stack failed" }
  Ok "facade http://localhost:$Port  |  core http://127.0.0.1:8888"
  exit 0
}

$hasDocker = $false
if (-not $SkipDocker -and (Test-Cmd docker)) {
  if ((Invoke-Quietly { docker ps }) -eq 0) { $hasDocker = $true }
}

if ($hasDocker) {
  Info "Ensuring dev Postgres is up"
  docker compose up -d db
  if ($LASTEXITCODE -ne 0) { Die "docker compose up -d db failed" }
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ((Invoke-Quietly { docker compose exec -T db pg_isready -U postgres -d app_db }) -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if ($ready) { Ok "postgres healthy" } else { Warn "postgres not ready yet - the app will retry on its own" }
} elseif (-not $SkipDocker) {
  Warn "Docker not available - assuming DATABASE_URL points at a reachable Postgres"
}

if ($Dev) {
  Info "next dev on http://localhost:$Port"
  npm run dev -- -p $Port
  exit $LASTEXITCODE
}

if (-not (Test-Path .next/BUILD_ID)) {
  Info "No production build found - running npm run build"
  npm run build
  if ($LASTEXITCODE -ne 0) { Die "npm run build failed" }
}

Info "next start on http://localhost:$Port"
npm start -- -p $Port
exit $LASTEXITCODE
