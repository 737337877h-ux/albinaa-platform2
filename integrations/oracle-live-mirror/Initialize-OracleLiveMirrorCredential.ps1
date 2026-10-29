param(
  [string]$CredentialPath = (Join-Path $env:LOCALAPPDATA 'Albinaa\OracleMirror\oracle-password.dpapi')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$directory = Split-Path -Parent ([IO.Path]::GetFullPath($CredentialPath))
New-Item -ItemType Directory -Path $directory -Force | Out-Null

$securePassword = Read-Host 'Oracle password (encrypted for this Windows user and this machine)' -AsSecureString
if ($securePassword.Length -eq 0) { throw 'Oracle password cannot be empty.' }

$encrypted = ConvertFrom-SecureString -SecureString $securePassword
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText([IO.Path]::GetFullPath($CredentialPath), $encrypted, $utf8NoBom)

$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $directory /inheritance:r /grant:r "${account}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict the credential directory permissions.' }

$roundTrip = Get-Content -LiteralPath $CredentialPath -Raw -Encoding UTF8 | ConvertTo-SecureString
if ($roundTrip.Length -eq 0) { throw 'Encrypted credential verification failed.' }

Write-Output ([IO.Path]::GetFullPath($CredentialPath))
