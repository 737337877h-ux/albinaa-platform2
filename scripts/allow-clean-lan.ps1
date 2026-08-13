$logPath = Join-Path $env:TEMP 'albinaa-clean-firewall.log'

try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run PowerShell as administrator.'
  }

  $displayName = 'Albinaa Clean LAN 3003 18002'
  Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule `
    -DisplayName $displayName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 3003,18002 `
    -Profile Private,Public `
    -RemoteAddress LocalSubnet `
    -ErrorAction Stop | Out-Null

  'SUCCESS' | Set-Content -LiteralPath $logPath -Encoding UTF8
  Write-Host 'Albinaa clean LAN access enabled.' -ForegroundColor Green
} catch {
  ($_ | Out-String) | Set-Content -LiteralPath $logPath -Encoding UTF8
  exit 1
}
