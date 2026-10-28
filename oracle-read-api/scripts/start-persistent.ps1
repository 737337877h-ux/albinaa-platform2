$ErrorActionPreference = 'Stop'
$gatewayRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $gatewayRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $gatewayRoot
$localEnv = Join-Path $gatewayRoot '.env'
$runtimeEnv = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
$envFile = if (Test-Path -LiteralPath $localEnv) { $localEnv } elseif (Test-Path -LiteralPath $runtimeEnv) { $runtimeEnv } else { $null }
if (-not $envFile) { throw 'Oracle Read API environment file is missing.' }
& 'C:\Program Files\nodejs\node.exe' "--env-file=$envFile" src/server.js *>> (Join-Path $logDirectory 'oracle-read-api.log')
