$ErrorActionPreference = 'Stop'

foreach ($port in 18002, 3003) {
  $ruleName = "ALRAQi Local LAN TCP $port"
  $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existingRule) {
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Profile Private,Public -Action Allow
  } else {
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $port `
      -Profile Private,Public `
      -RemoteAddress LocalSubnet
  }
}

'SUCCESS: Local LAN access is enabled for TCP 18002 and 3003.'
