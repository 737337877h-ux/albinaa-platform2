param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data-ias20191-test\runtime'
$process = $null
$names = @('HOST','PORT','ORACLE_USER','ORACLE_PASSWORD','ORACLE_PASSWORD_BASE64','ORACLE_CONNECT_STRING',
  'ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA','ORACLE_ALLOWED_SCHEMAS','ORACLE_READ_API_KEY')

try {
  $settings = @{}
  foreach ($line in Get-Content -LiteralPath $ReadApiEnvPath) {
    if ($line -match '^([^#=]+)=(.*)$') { $settings[$matches[1].Trim()] = $matches[2].Trim() }
  }
  foreach ($name in @('ORACLE_USER','ORACLE_PASSWORD','ORACLE_PASSWORD_BASE64','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR')) {
    if ($settings[$name]) { Set-Item -Path "Env:$name" -Value $settings[$name] }
  }
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $env:HOST = '127.0.0.1'; $env:PORT = '3013'; $env:ORACLE_SCHEMA = 'IAS20191'
  $env:ORACLE_ALLOWED_SCHEMAS = 'IAS20191'; $env:ORACLE_READ_API_KEY = 'temporary-live-read-validation'
  $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'src/server.js' `
    -WorkingDirectory (Join-Path $root 'oracle-read-api') `
    -RedirectStandardOutput (Join-Path $runtime 'validation-read.out.log') `
    -RedirectStandardError (Join-Path $runtime 'validation-read.err.log') -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3013/health' -TimeoutSec 2).StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if ($attempt -ge 30) { throw 'Read gateway failed to start' }
  $headers = @{ Authorization = 'Bearer temporary-live-read-validation' }
  $warehouses = Invoke-RestMethod -Headers $headers 'http://127.0.0.1:3013/inventory/warehouses?schema=IAS20191'
  $items = Invoke-RestMethod -Headers $headers 'http://127.0.0.1:3013/inventory/items?limit=5&schema=IAS20191'
  $detail = Invoke-RestMethod -Headers $headers 'http://127.0.0.1:3013/inventory/items/00101-01-01?schema=IAS20191'
  $receiptCatalog = Invoke-RestMethod -Headers $headers `
    'http://127.0.0.1:3013/requests/catalog?schema=IAS20191&purpose=receipt&oracleUserId=1&branchNo=1'
  $paymentCatalog = Invoke-RestMethod -Headers $headers `
    'http://127.0.0.1:3013/requests/catalog?schema=IAS20191&purpose=payment&oracleUserId=1&branchNo=1'
  [pscustomobject]@{
    warehouses = $warehouses.items.Count; sampleItems = $items.items.Count; totalItems = $items.total
    itemName = $detail.nameAr; units = $detail.units.Count; stockRows = $detail.stockRows.Count
    snapshot = $detail.snapshotRunId
    receiptCashboxes = $receiptCatalog.cashboxes.Count; receiptBanks = $receiptCatalog.banks.Count
    paymentCashboxes = $paymentCatalog.cashboxes.Count; paymentBanks = $paymentCatalog.banks.Count
    collectors = $receiptCatalog.collectors.Count; customers = $receiptCatalog.parties.customers.Count
    vendors = $receiptCatalog.parties.vendors.Count; employees = $receiptCatalog.parties.employees.Count
    otherParties = $receiptCatalog.parties.other.Count
  } | ConvertTo-Json -Compress
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  foreach ($name in $names) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
}
