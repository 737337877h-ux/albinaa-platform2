$ErrorActionPreference = 'Stop'
$gatewayRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $gatewayRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $gatewayRoot
& 'C:\Program Files\nodejs\node.exe' --env-file=.env src/server.js *>> (Join-Path $logDirectory 'oracle-read-api.log')
