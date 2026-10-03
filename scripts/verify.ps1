#Requires -Version 5.1
<#
.SYNOPSIS
  VietScope - local verification, mirrors .github/workflows/ci.yml (Windows).
.DESCRIPTION
  Runs: lint, typecheck, boundary check, format check, production build,
  Python<->TS contract decode, DB-backed regression scripts (when a database
  is reachable) and the Python core suite (when uv is installed).
  Exit code 0 = everything that ran passed. Skipped groups are reported.
.EXAMPLE
  .\scripts\verify.ps1
  .\scripts\verify.ps1 -SkipPython -SkipDb   # quick facade-only pass
#>
[CmdletBinding()]
param(
  [switch]$SkipPython,
  [switch]$SkipDb,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Info($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Test-Cmd($name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

# Under EAP=Stop, redirecting a native command's stderr (*> $null) turns stderr
# lines into ErrorRecords that terminate the script. Run quiet native calls
# with EAP=Continue instead (function-scoped, reverts on return).
function Invoke-Quietly([scriptblock]$Block) {
  $ErrorActionPreference = 'Continue'
  & $Block *> $null
  return $LASTEXITCODE
}

$script:Results = New-Object System.Collections.Generic.List[object]
$script:Current = ''

function Step([string]$Name, [scriptblock]$Block) {
  $script:Current = $Name
  Info $Name
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
  $script:Results.Add([pscustomobject]@{ Step = $Name; Status = 'PASS' })
}

function Skip([string]$Name, [string]$Why) {
  Info $Name
  Warn "skipped - $Why"
  $script:Results.Add([pscustomobject]@{ Step = $Name; Status = "SKIP ($Why)" })
}

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

$failed = $false
try {
  Step 'lint (eslint)'           { npm run lint }
  Step 'typecheck (tsc)'         { npm run typecheck }
  Step 'boundary check'          { npm run check:boundaries }
  Info 'format check (prettier) - advisory'
  $fmtRc = Invoke-Quietly { npm run format:check }
  if ($fmtRc -eq 0) {
    $script:Results.Add([pscustomobject]@{ Step = 'format check (prettier)'; Status = 'PASS' })
  } else {
    Warn 'prettier drift exists (advisory - CI does not gate on it; normalize with npm run format)'
    $script:Results.Add([pscustomobject]@{ Step = 'format check (prettier)'; Status = 'ADVISORY FAIL' })
  }
  if ($SkipBuild) { Skip 'production build' '-SkipBuild' }
  else {
    if (-not (Get-DotEnvValue 'DATABASE_URL')) {
      $env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/app_db'
      Warn "DATABASE_URL unset - using a dummy DSN for build evaluation"
    }
    Step 'production build (next build)' { npm run build }
  }
  Step 'Python -> TypeScript contract decode' { npx --no-install tsx scripts/test-core-port.ts }

  # ------------------------------------------------------------- DB group ---
  $dbReady = $false
  if ($SkipDb) { Warn "-SkipDb: database-backed tests skipped" }
  else {
    $dbUrl = Get-DotEnvValue 'DATABASE_URL'
    if ($dbUrl -match 'postgres(?:ql)?://(?:[^:@/]+(?::[^@/]*)?@)?([^:/@?]+)(?::(\d+))?/') {
      $h = $Matches[1]; $p = 5432; if ($Matches[2]) { $p = [int]$Matches[2] }
      $dbReady = Test-TcpPort $h $p
      if (-not $dbReady -and (Test-Cmd docker)) {
        $dockerUp = (Invoke-Quietly { docker ps }) -eq 0
        if ($dockerUp) {
          Warn "Postgres not reachable at ${h}:$p - trying docker compose up -d db"
          [void](Invoke-Quietly { docker compose up -d db })
          for ($i = 0; $i -lt 30 -and -not $dbReady; $i++) {
            Start-Sleep -Seconds 1
            $dbReady = Test-TcpPort $h $p
          }
        }
      }
      if ($dbReady) { Write-Host "  Postgres reachable at ${h}:$p" -ForegroundColor Green }
    } else { Warn "could not parse DATABASE_URL ($dbUrl)" }
  }

  if (-not $dbReady -and -not $SkipDb) {
    $script:Results.Add([pscustomobject]@{ Step = 'DB-backed tests'; Status = 'SKIP (no database reachable)' })
  } elseif ($dbReady) {
    Step 'conformance (reference backend)'       { npm run test:conformance }
    Step 'smoke upstreams'                       { npx --no-install tsx scripts/smoke-upstreams.ts }
    Step 'auth'                                  { npx --no-install tsx scripts/test-auth.ts }
    Step 'bad-search review workflow'            { npm run test:bad-search-review }
    Step 'golden promotion'                      { npm run test:golden }
  }

  # --------------------------------------------------------- Python group ---
  if ($SkipPython) { Skip 'Python core suite' '-SkipPython' }
  elseif (-not (Test-Cmd uv)) { Skip 'Python core suite' 'uv not installed' }
  else {
    Push-Location services/search-router
    try {
      Step 'uv sync --frozen' { uv sync --frozen }
      Step 'ruff (repo rules)' { uv run ruff check --select E4,E7,E9,F . }
      Step 'ruff (P-NEXT surface)' {
        uv run ruff check api/retrieve.py core/unified_retrieve.py `
          tests/test_retrieve_contract.py tests/test_retrieve_bindings.py `
          tests/test_compose_mounts.py
      }
      Step 'pyright (retrieval core)' { uv run pyright -p pyright-pnextconfig.json }
      Step 'pytest (not e2e, not live)' { uv run pytest -q -m "not e2e and not live" }
    } finally { Pop-Location }
  }
}
catch {
  Write-Host ""
  Write-Host "  [fail] $($_.Exception.Message)" -ForegroundColor Red
  $script:Results.Add([pscustomobject]@{ Step = $script:Current; Status = 'FAIL' })
  $failed = $true
}

Write-Host ""
Write-Host "================ verify summary ================" -ForegroundColor Cyan
foreach ($r in $script:Results) { Write-Host ("  {0,-44} {1}" -f $r.Step, $r.Status) }
if ($failed) { exit 1 }
Write-Host "All executed checks passed." -ForegroundColor Green
exit 0
