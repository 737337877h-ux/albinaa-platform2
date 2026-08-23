param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot 'output'),
  [string]$OracleAlias = 'YEMENSOFT',
  [string]$OracleUser = 'ys',
  [string]$OracleHome = 'C:\OraNT'
)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'Invoke-OracleMovementSnapshot.ps1'
if ([IntPtr]::Size -eq 4) { & $script -OutputRoot $OutputRoot -OracleAlias $OracleAlias -OracleUser $OracleUser -OracleHome $OracleHome; exit $LASTEXITCODE }
$powershell32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell32)) { throw '32-bit PowerShell was not found.' }
& $powershell32 -NoProfile -ExecutionPolicy Bypass -File $script -OutputRoot $OutputRoot -OracleAlias $OracleAlias -OracleUser $OracleUser -OracleHome $OracleHome
exit $LASTEXITCODE
