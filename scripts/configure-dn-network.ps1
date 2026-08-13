$ErrorActionPreference = 'Stop'
$logPath = Join-Path $PSScriptRoot 'configure-dn-network.log'

try {

$adapter = Get-NetAdapter |
  Where-Object InterfaceDescription -Like 'Intel(R) Wi-Fi 6 AX200*' |
  Select-Object -First 1

if (-not $adapter) {
  throw 'DN Wi-Fi adapter was not found.'
}

$profile = Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue
if (-not $profile -or $profile.Name -ne 'DN') {
  (& netsh wlan connect name='DN 2' ssid='DN') | Out-File -LiteralPath $logPath -Encoding utf8
  Start-Sleep -Seconds 12
  $profile = Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue
}
if (-not $profile -or $profile.Name -ne 'DN') {
  "Could not connect to DN. Current network: $($profile.Name)" | Add-Content -LiteralPath $logPath -Encoding utf8
  throw 'Could not connect to the saved DN network.'
}

Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Disabled

Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object IPAddress -ne '192.168.1.14' |
  Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue

if (-not (Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -IPAddress '192.168.1.14' -ErrorAction SilentlyContinue)) {
  New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress '192.168.1.14' -PrefixLength 24 -DefaultGateway '192.168.1.1'
}

Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses @('192.168.1.1', '8.8.8.8')
Set-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -NetworkCategory Private

foreach ($port in 18002, 3003) {
  $ruleName = "ALRAQi DN TCP $port"
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private
  }
}

'DN network configured: 192.168.1.14; ports 18002 and 3003 allowed.' | Add-Content -LiteralPath $logPath -Encoding utf8
} catch {
  "ERROR: $($_.Exception.Message)" | Add-Content -LiteralPath $logPath -Encoding utf8
  throw
}
