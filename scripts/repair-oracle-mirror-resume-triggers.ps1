param(
  [string[]]$TaskNames = @(
    'Albinaa Oracle ReadOnly Mirror',
    'Albinaa Oracle ReadOnly Movements'
  )
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder = $service.GetFolder('\')
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

foreach ($taskName in $TaskNames) {
  $task = $folder.GetTask("\$taskName")
  $definition = $task.Definition
  $triggers = $definition.Triggers
  $hasLogon = $false
  $hasUnlock = $false

  for ($index = 1; $index -le $triggers.Count; $index++) {
    $trigger = $triggers.Item($index)
    if ($trigger.Type -eq 9 -and $trigger.UserId -eq $currentUser) { $hasLogon = $true }
    if ($trigger.Type -eq 11 -and $trigger.StateChange -eq 8 -and $trigger.UserId -eq $currentUser) {
      $hasUnlock = $true
    }
  }

  if (-not $hasLogon) {
    $logon = $triggers.Create(9) # TASK_TRIGGER_LOGON
    $logon.UserId = $currentUser
    $logon.Enabled = $true
  }
  if (-not $hasUnlock) {
    $unlock = $triggers.Create(11) # TASK_TRIGGER_SESSION_STATE_CHANGE
    $unlock.StateChange = 8        # TASK_SESSION_UNLOCK
    $unlock.UserId = $currentUser
    $unlock.Enabled = $true
  }

  if ($taskName -eq 'Albinaa Oracle ReadOnly Movements') {
    # Allow the bounded cold-start export plus validation/publication to finish.
    $definition.Settings.ExecutionTimeLimit = 'PT20M'
  }

  # Preserve the existing action, principal, periodic trigger, and settings.
  # InteractiveToken avoids storing a Windows password in the task.
  $null = $folder.RegisterTaskDefinition($taskName, $definition, 6, $currentUser, $null, 3, $null)
}

Get-ScheduledTask -TaskName $TaskNames |
  Select-Object TaskName, State, @{Name='TriggerTypes';Expression={($_.Triggers.CimClass.CimClassName -join ',')}}
