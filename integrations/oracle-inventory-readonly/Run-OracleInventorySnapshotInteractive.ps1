param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [string]$OracleAlias = 'YEMENSOFT',
  [string]$OracleUser = 'ys',
  [string]$OracleHome = 'C:\OraNT'
)

$ErrorActionPreference = 'Stop'
$resultPath = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) 'interactive-result.json'
if ([IntPtr]::Size -ne 4) {
  throw 'Run this interactive wrapper with 32-bit PowerShell.'
}
$null = Add-Type -AssemblyName System.Windows.Forms
$null = Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'AlBinaa - Oracle read-only'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(430, 175)
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$label = New-Object System.Windows.Forms.Label
$label.Text = 'Enter the Oracle read-only password (input is hidden):'
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(18, 18)
$form.Controls.Add($label)

$passwordBox = New-Object System.Windows.Forms.TextBox
$passwordBox.Location = New-Object System.Drawing.Point(18, 48)
$passwordBox.Size = New-Object System.Drawing.Size(375, 24)
$passwordBox.UseSystemPasswordChar = $true
$form.Controls.Add($passwordBox)

$okButton = New-Object System.Windows.Forms.Button
$okButton.Text = 'Start read-only snapshot'
$okButton.Location = New-Object System.Drawing.Point(205, 88)
$okButton.Size = New-Object System.Drawing.Size(188, 30)
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $okButton
$form.Controls.Add($okButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Cancel'
$cancelButton.Location = New-Object System.Drawing.Point(18, 88)
$cancelButton.Size = New-Object System.Drawing.Size(100, 30)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancelButton
$form.Controls.Add($cancelButton)

$form.Add_Shown({ $passwordBox.Focus() })
$dialogResult = $form.ShowDialog()
if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($passwordBox.Text)) {
  throw 'Oracle password entry was cancelled.'
}
$securePassword = ConvertTo-SecureString $passwordBox.Text -AsPlainText -Force
$passwordBox.Text = ''
$form.Dispose()
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:ALBINAA_ORACLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $snapshotDirectory = & (Join-Path $PSScriptRoot 'Invoke-OracleInventorySnapshot.ps1') `
    -OutputRoot $OutputRoot -OracleAlias $OracleAlias -OracleUser $OracleUser -OracleHome $OracleHome
  [pscustomobject]@{
    success = $true
    snapshotDirectory = $snapshotDirectory
  } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
catch {
  $safeMessage = $_.Exception.Message -replace '(?i)password=[^;\s]*', 'Password=[REDACTED]'
  [pscustomobject]@{
    success = $false
    error = $safeMessage
  } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
  throw
}
finally {
  Remove-Item Env:ALBINAA_ORACLE_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $securePassword = $null
}
