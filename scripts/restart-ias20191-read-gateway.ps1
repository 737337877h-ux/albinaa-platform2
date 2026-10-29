param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env',
  [int]$ReadApiPort = 13013,
  [switch]$UseStoredPassword,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data-ias20191-test\runtime'
$envFile = Join-Path $root '.env.ias20191-test'
$pidFile = Join-Path $runtime 'gateway-pids.json'
$passwordPointer = [IntPtr]::Zero
$readProcess = $null
$keepProcess = $false

function Read-EnvironmentFile([string]$path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^([^#=]+)=(.*)$') {
      $values[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $values
}

function Wait-Health([string]$url, [System.Diagnostics.Process]$process) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) {
      throw "Gateway process stopped before becoming ready: $($process.Id)"
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "Gateway did not become ready: $url"
}

function Stop-ReadGateway {
  $processIds = @()
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      if ($saved.readApi) { $processIds += $saved.readApi }
    } catch {}
  }

  $processIds += Get-NetTCPConnection -LocalPort $ReadApiPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess

  foreach ($processId in ($processIds | Sort-Object -Unique)) {
    $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if ($process.ProcessName -ne 'node') {
      throw "Port $ReadApiPort is owned by a non-Node process and was not stopped: $($process.Id)"
    }
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
    $process.WaitForExit()
  }
}

try {
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) {
    throw "Read API environment file was not found: $ReadApiEnvPath"
  }
  if (-not (Test-Path -LiteralPath $envFile)) {
    throw "IAS20191 isolated environment file was not found: $envFile"
  }

  $oracle = Read-EnvironmentFile $ReadApiEnvPath
  $isolated = Read-EnvironmentFile $envFile
  if (-not $oracle['ORACLE_CONNECT_STRING'] -or -not $oracle['ORACLE_CLIENT_LIB_DIR']) {
    throw 'Oracle connection location settings are missing'
  }
  if (-not $isolated['ORACLE_READ_API_KEY']) {
    throw 'ORACLE_READ_API_KEY is missing from the isolated environment'
  }

  if ($UseStoredPassword) {
    if (-not $oracle['ORACLE_PASSWORD_BASE64']) { throw 'Stored ALBINAA_RO password is unavailable' }
  } else {
    $securePassword = Read-Host 'Enter ALBINAA_RO password (input is hidden)' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $readPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if (-not $readPassword) { throw 'ALBINAA_RO password is required' }
  }

  Stop-ReadGateway
  $logs = Join-Path $runtime 'logs'
  New-Item -ItemType Directory -Force -Path $logs | Out-Null

  $node = (Get-Command node -ErrorAction Stop).Source
  $env:HOST = '127.0.0.1'
  $env:PORT = "$ReadApiPort"
  $env:ORACLE_USER = 'ALBINAA_RO'
  if ($UseStoredPassword) { $env:ORACLE_PASSWORD_BASE64 = $oracle['ORACLE_PASSWORD_BASE64'] }
  else { $env:ORACLE_PASSWORD = $readPassword }
  $env:ORACLE_CONNECT_STRING = $oracle['ORACLE_CONNECT_STRING']
  $env:ORACLE_CLIENT_LIB_DIR = $oracle['ORACLE_CLIENT_LIB_DIR']
  $env:ORACLE_SCHEMA = 'IAS20261'
  $env:ORACLE_ALLOWED_SCHEMAS = 'IAS20261,IAS20191'
  $primaryReadApiKey = if ($oracle['ORACLE_READ_API_KEY']) { $oracle['ORACLE_READ_API_KEY'] } else { $isolated['ORACLE_READ_API_KEY'] }
  $env:ORACLE_READ_API_KEY = $primaryReadApiKey
  $env:ORACLE_READ_API_KEYS = (@($primaryReadApiKey, $isolated['ORACLE_READ_API_KEY']) | Sort-Object -Unique) -join ','

  $readProcess = Start-Process -FilePath $node -ArgumentList 'src/server.js' `
    -WorkingDirectory (Join-Path $root 'oracle-read-api') `
    -RedirectStandardOutput (Join-Path $logs 'read.out.log') `
    -RedirectStandardError (Join-Path $logs 'read.err.log') `
    -WindowStyle Hidden -PassThru

  Wait-Health "http://127.0.0.1:$ReadApiPort/health" $readProcess
  $keepProcess = $true

  $pids = [ordered]@{
    readApi = $readProcess.Id
    writeApi = $null
    ias20261PurchaseWriteApi = $null
    ias20261PaymentWriteApi = $null
    ias20261JournalWriteApi = $null
    ias20261InventoryWriteApi = $null
  }
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      if ($saved.writeApi) { $pids.writeApi = $saved.writeApi }
      if ($saved.ias20261PurchaseWriteApi) { $pids.ias20261PurchaseWriteApi = $saved.ias20261PurchaseWriteApi }
      if ($saved.ias20261PaymentWriteApi) { $pids.ias20261PaymentWriteApi = $saved.ias20261PaymentWriteApi }
      if ($saved.ias20261JournalWriteApi) { $pids.ias20261JournalWriteApi = $saved.ias20261JournalWriteApi }
      if ($saved.ias20261InventoryWriteApi) { $pids.ias20261InventoryWriteApi = $saved.ias20261InventoryWriteApi }
    } catch {}
  }
  $pids | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

  $headers = @{ Authorization = "Bearer $primaryReadApiKey" }
  try {
    $catalog = Invoke-RestMethod -Headers $headers `
      -Uri "http://127.0.0.1:$ReadApiPort/requests/catalog?schema=IAS20261&purpose=receipt&oracleUserId=1&branchNo=1" `
      -TimeoutSec 20
    $created = Invoke-RestMethod -Headers $headers `
      -Uri "http://127.0.0.1:$ReadApiPort/requests/created?schema=IAS20191&limit=1" `
      -TimeoutSec 15
  } catch {
    $response = $_.Exception.Response
    if ($response) {
      if ($response.Content) { $details = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
      elseif ($response.PSObject.Methods.Name -contains 'GetResponseStream') {
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        try { $details = $reader.ReadToEnd() } finally { $reader.Dispose() }
      }
      if ($details) { throw "Created-requests check failed: $details" }
    }
    throw
  }
  if ($created.mode -ne 'SELECT_ONLY' -or $created.oracleWrite -ne 'NONE') {
    throw 'The created-requests endpoint did not confirm SELECT-only mode'
  }
  if ($catalog.mode -ne 'SELECT_ONLY' -or $catalog.schema -ne 'IAS20261') {
    throw 'The operational catalog endpoint did not confirm IAS20261 SELECT-only mode'
  }

  Write-Host "SUCCESS: Oracle Read gateway is listening on 127.0.0.1:$ReadApiPort for IAS20261 source data and IAS20191 test-status reads." -ForegroundColor Green
  Write-Host 'Both endpoints are SELECT-only and performed no Oracle write.' -ForegroundColor Green
  Write-Host 'The writer gateway, web passwords, Docker services, and IAS20261 were not changed.' -ForegroundColor Green
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'HOST','PORT','ORACLE_USER','ORACLE_PASSWORD','ORACLE_PASSWORD_BASE64','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR',
  'ORACLE_SCHEMA','ORACLE_ALLOWED_SCHEMAS','ORACLE_READ_API_KEY','ORACLE_READ_API_KEYS' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $readPassword = $null
  if (-not $keepProcess -and $readProcess -and -not $readProcess.HasExited) {
    Stop-Process -Id $readProcess.Id -Force -ErrorAction SilentlyContinue
  }
}

if (-not $NoPause) { Read-Host 'Press Enter to close this window' }
