param(
  [string]$TaskName = 'Albinaa Oracle ReadOnly Mirror',
  [int]$IntervalMinutes = 5
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($IntervalMinutes -lt 5) { throw 'The live mirror interval cannot be less than 5 minutes.' }

$runner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Invoke-OracleLiveMirror.ps1'))
$hiddenLauncher = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Invoke-HiddenPowerShell.vbs'))
$credential = Join-Path $env:LOCALAPPDATA 'Albinaa\OracleMirror\oracle-password.dpapi'
if (-not (Test-Path -LiteralPath $credential)) { throw 'Initialize the encrypted Oracle credential before registering the task.' }
if (-not (Test-Path -LiteralPath $hiddenLauncher)) { throw 'The hidden PowerShell launcher is missing.' }

$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$hiddenLauncher`" `"$runner`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Description 'AlBinaa SELECT-only Oracle mirror for customers, balances, and inventory.' -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State,TaskPath
