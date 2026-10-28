param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data-ias20191-test\runtime'
$envFile = Join-Path $root '.env.ias20191-test'
$pidFile = Join-Path $runtime 'gateway-pids.json'
$logs = Join-Path $runtime 'logs'
$passwordPointer = [IntPtr]::Zero
$writeProcess = $null
$started = $false

function Read-Hidden([string]$prompt, [int]$minimumLength) {
  $secure = Read-Host $prompt -AsSecureString
  $script:passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($script:passwordPointer)
  if ($plain.Length -lt $minimumLength) { throw "Password must contain at least $minimumLength characters" }
  return $plain
}

function Read-EnvironmentFile([string]$path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
  }
  return $values
}

function Wait-Health([string]$url, [System.Diagnostics.Process]$process) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw "Gateway process stopped before becoming ready: $($process.Id)" }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "Gateway did not become ready: $url"
}

try {
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) { throw "Read API environment file was not found: $ReadApiEnvPath" }
  if (-not (Test-Path -LiteralPath $envFile)) { throw "IAS20191 web environment file was not found: $envFile" }

  $oracle = Read-EnvironmentFile $ReadApiEnvPath
  $web = Read-EnvironmentFile $envFile
  if (-not $oracle['ORACLE_CONNECT_STRING'] -or -not $oracle['ORACLE_CLIENT_LIB_DIR']) {
    throw 'Oracle connection location settings are missing'
  }
  if (-not $web['ORACLE_WRITE_API_KEY']) { throw 'ORACLE_WRITE_API_KEY is missing from the IAS20191 web environment' }

  $writePassword = Read-Hidden 'Enter ALBINAAWRITER password (input is hidden)' 12

  $listeners = @(Get-NetTCPConnection -LocalPort 13012 -State Listen -ErrorAction SilentlyContinue)
  foreach ($processId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'node') {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      $process.WaitForExit()
    }
  }

  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $node = (Get-Command node -ErrorAction Stop).Source
  $env:HOST = '127.0.0.1'
  $env:PORT = '13012'
  $env:ORACLE_USER = 'ALBINAAWRITER'
  $env:ORACLE_PASSWORD = $writePassword
  $env:ORACLE_CONNECT_STRING = $oracle['ORACLE_CONNECT_STRING']
  $env:ORACLE_CLIENT_LIB_DIR = $oracle['ORACLE_CLIENT_LIB_DIR']
  $env:ORACLE_SCHEMA = 'IAS20191'
  $env:ORACLE_REQUEST_BRANCH_YEAR = '2019'
  $env:ORACLE_REQUEST_DATE = '2020-12-31'
  $env:ORACLE_WRITE_API_KEY = $web['ORACLE_WRITE_API_KEY']

  $writeProcess = Start-Process -FilePath $node -ArgumentList 'src/server.js' `
    -WorkingDirectory (Join-Path $root 'oracle-write-api') `
    -RedirectStandardOutput (Join-Path $logs 'write.out.log') `
    -RedirectStandardError (Join-Path $logs 'write.err.log') `
    -WindowStyle Hidden -PassThru

  Wait-Health 'http://127.0.0.1:13012/health' $writeProcess

  $gatewayPids = @{ readApi = $null; writeApi = $writeProcess.Id }
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      $gatewayPids.readApi = $saved.readApi
    } catch {}
  }
  $gatewayPids | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
  $started = $true
  Write-Host 'SUCCESS: IAS20191 Oracle Write API restarted with the current inventory-count routes.' -ForegroundColor Green
  Write-Host 'IAS20261 was not changed.' -ForegroundColor Green
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'HOST','PORT','ORACLE_USER','ORACLE_PASSWORD','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA',
  'ORACLE_REQUEST_BRANCH_YEAR','ORACLE_REQUEST_DATE','ORACLE_WRITE_API_KEY' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $writePassword = $null
  if (-not $started -and $writeProcess -and -not $writeProcess.HasExited) {
    Stop-Process -Id $writeProcess.Id -Force -ErrorAction SilentlyContinue
  }
}

Read-Host 'Press Enter to close this window'
