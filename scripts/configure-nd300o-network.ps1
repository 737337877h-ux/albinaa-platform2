$ErrorActionPreference = 'Stop'
$logPath = Join-Path $PSScriptRoot 'configure-nd300o-network.log'

try {
  $adapter = Get-NetAdapter |
    Where-Object InterfaceDescription -Like 'Intel(R) Wi-Fi 6 AX200*' |
    Select-Object -First 1

  if (-not $adapter) {
    throw 'Wi-Fi adapter was not found.'
  }

  $profile = Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue
  $alreadyConfigured = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -IPAddress '192.168.8.148' -ErrorAction SilentlyContinue
  if ((-not $profile -or $profile.Name -ne 'ND300O') -and -not $alreadyConfigured) {
    throw "ND300O is not connected. Current network: $($profile.Name)"
  }

  Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Disabled

  Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object IPAddress -ne '192.168.8.148' |
    Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue

  if (-not (Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -IPAddress '192.168.8.148' -ErrorAction SilentlyContinue)) {
    New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress '192.168.8.148' -PrefixLength 24 -DefaultGateway '192.168.8.1'
  }

  Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses @('192.168.8.1', '8.8.8.8')
  try {
    Set-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -NetworkCategory Private
  } catch {
    # Windows may keep a static local network in the Identifying state.
    # The firewall rules below explicitly cover both local categories.
  }

  foreach ($port in 18002, 3003) {
    $ruleName = "ALRAQi ND300O TCP $port"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private,Public
    }
  }

  'SUCCESS: ND300O configured at 192.168.8.148; TCP 18002 and 3003 allowed.' |
    Set-Content -LiteralPath $logPath -Encoding utf8
} catch {
  "ERROR: $($_.Exception.Message)" | Set-Content -LiteralPath $logPath -Encoding utf8
  throw
}
