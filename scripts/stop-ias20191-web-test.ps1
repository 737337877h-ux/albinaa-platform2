$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data-ias20191-test\runtime'
$envFile = Join-Path $root '.env.ias20191-test'
$pidFile = Join-Path $runtime 'gateway-pids.json'

try {
  if (Test-Path -LiteralPath $envFile) {
    & docker compose --env-file $envFile -f (Join-Path $root 'docker-compose.ias20191-test.yml') down
  }
  if (Test-Path -LiteralPath $pidFile) {
    $pids = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    @($pids.readApi, $pids.writeApi) | Where-Object { $_ } | ForEach-Object {
      Stop-Process -Id ([int]$_) -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force
  }
  Write-Host 'IAS20191 isolated web test was stopped. Its database files were kept.' -ForegroundColor Green
  Write-Host 'Relock ALBINAAWRITER from an Oracle administrator session after every write test.' -ForegroundColor Yellow
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Read-Host 'Press Enter to close this window'
