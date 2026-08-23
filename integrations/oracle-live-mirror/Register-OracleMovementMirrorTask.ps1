param([string]$TaskName='Albinaa Oracle ReadOnly Movements',[int]$IntervalMinutes=5)
$ErrorActionPreference='Stop';if($IntervalMinutes-lt 5){throw'Movement interval cannot be less than 5 minutes.'}
$runner=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Invoke-OracleMovementMirror.ps1'));$hiddenLauncher=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Invoke-HiddenPowerShell.vbs'))
if(-not(Test-Path -LiteralPath $hiddenLauncher)){throw'The hidden PowerShell launcher is missing.'}
$wscript=Join-Path $env:SystemRoot 'System32\wscript.exe';$action=New-ScheduledTaskAction -Execute $wscript -Argument "`"$hiddenLauncher`" `"$runner`""
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 12) -Hidden
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'AlBinaa detailed customer and inventory movement mirror; Oracle SELECT only.' -Force|Out-Null
Get-ScheduledTask -TaskName $TaskName|Select-Object TaskName,State
