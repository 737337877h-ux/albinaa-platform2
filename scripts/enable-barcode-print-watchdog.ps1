$ErrorActionPreference = 'Stop'
$taskName = 'AlBinaa Barcode Print Agent'
$agentRoot = 'E:\albinaa-platform-staging\albinaa-platform2\data-clean\barcode-agent'
$task = Get-ScheduledTask -TaskName $taskName
if (-not $task.Settings.Enabled) { throw 'Barcode print task is disabled; review its state before enabling it' }
$backup = Join-Path $agentRoot ('task.before-watchdog-20261024-' + [Guid]::NewGuid().ToString('N').Substring(0,8) + '.xml')
Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backup -Encoding UTF8
# Preserve the existing action, identity, printer route, logon trigger and settings.
# IgnoreNew and the worker mutex prevent duplicate print agents.
if ([int]$task.Settings.MultipleInstances -ne 2) { throw 'Expected MultipleInstances=IgnoreNew before installing the watchdog' }
$existing = @($task.Triggers)
$hasWatchdog = @($existing | Where-Object { $_.Repetition.Interval -eq 'PT1M' }).Count -gt 0
if (-not $hasWatchdog) {
  $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  Set-ScheduledTask -TaskName $taskName -Trigger @($existing + $watchdog) | Out-Null
}
Start-ScheduledTask -TaskName $taskName
[pscustomobject]@{task=$taskName;backup=$backup;watchdogInterval='PT1M';started=$true} | ConvertTo-Json -Compress
