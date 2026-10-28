param(
 [Parameter(Mandatory=$true)][string]$SecretFile,
 [string]$Api='http://127.0.0.1:18002',
 [string]$PrinterName='ZDesigner GK888t (EPL)',
 [string]$SettingsSourcePrinter=''
)
$ErrorActionPreference='Stop'
$mutex = New-Object Threading.Mutex($false,'Local\AlBinaaBarcodePrinter')
if (-not $mutex.WaitOne(0)) { exit }
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'barcode-label-layout.ps1')
$secure = (Get-Content -LiteralPath $SecretFile -Raw).Trim() | ConvertTo-SecureString
$credential = New-Object Management.Automation.PSCredential('printer',$secure)
$headers = @{'x-print-key'=$credential.GetNetworkCredential().Password}
try {
 while ($true) {
  try {
   # Do not claim work unless the configured Windows printer is available.
   $settings = New-Object Drawing.Printing.PrinterSettings
   $settings.PrinterName=$printerName
   if (-not $settings.IsValid) { throw 'Configured printer is unavailable' }
   $job = Invoke-RestMethod -Uri "$Api/barcode-print/agent/next" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 15
   if ($job) {
    $status='failed'; $doc=$null; $clock=[Diagnostics.Stopwatch]::StartNew()
    try {
     $p=$job.payload
     if ($p.bits -notmatch '^[01]{20,1500}$' -or $p.copies -lt 1 -or $p.copies -gt 100) { throw 'Invalid label' }
     $doc=New-Object Drawing.Printing.PrintDocument
     $doc.PrinterSettings.PrinterName=$printerName
     if($SettingsSourcePrinter){
      # Preserve the approved driver DEVMODE while routing through the local SMB port.
      $source=New-Object Drawing.Printing.PrinterSettings
      $source.PrinterName=$SettingsSourcePrinter
      if(-not $source.IsValid){throw 'Source printer settings are unavailable'}
      $mode=$source.GetHdevmode()
      try{$doc.PrinterSettings.SetHdevmode($mode);$doc.DefaultPageSettings.SetHdevmode($mode)}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($mode)}
     }
     $doc.PrintController=New-Object Drawing.Printing.StandardPrintController
     $doc.DocumentName='AlBinaa '+$job.id
     $doc.DefaultPageSettings.PaperSize=New-Object Drawing.Printing.PaperSize('Barcode',[int]($p.widthMm*100/25.4),[int]($p.heightMm*100/25.4))
     $doc.DefaultPageSettings.Margins=New-Object Drawing.Printing.Margins(0,0,0,0)
     # Check the exact printer metrics before beginning a physical print job.
     $measure=$doc.PrinterSettings.CreateMeasurementGraphics()
     try { $null=Draw-BarcodeLabel -Graphics $measure -Label $p }
     finally { $measure.Dispose() }
     $script:labelPage=0
     $handler=[Drawing.Printing.PrintPageEventHandler]{
      param($sender,$e)
      $g=$e.Graphics
      $g.PageUnit=[Drawing.GraphicsUnit]::Millimeter
      $g.TranslateTransform(-$e.PageSettings.HardMarginX*25.4/100,-$e.PageSettings.HardMarginY*25.4/100)
      $null=Draw-BarcodeLabel -Graphics $g -Label $p
      $script:labelPage++; $e.HasMorePages=$script:labelPage -lt $p.copies
     }
     $doc.add_PrintPage($handler)
     # A failure once Print starts is ambiguous; never automatically print again.
     $status='unknown'
     $doc.Print()
     $status='submitted'
    } catch { Write-Warning ('Print job '+$job.id+': '+$status) }
    finally { if ($doc) { $doc.Dispose() } }
    $timing=@{at=[DateTime]::UtcNow.ToString('o');job=$job.id;status=$status;elapsedMs=$clock.ElapsedMilliseconds}|ConvertTo-Json -Compress
    try { Add-Content -LiteralPath (Join-Path $PSScriptRoot 'print-timings.jsonl') -Value $timing -Encoding UTF8 } catch { Write-Warning 'Print timing log unavailable' }
    $body=@{id=$job.id;claim=$job.claim;status=$status}|ConvertTo-Json -Compress
    # Retry acknowledgements, never the physical print operation.
    for($attempt=0;$attempt -lt 3;$attempt++) {
     try { $null=Invoke-RestMethod -Uri "$Api/barcode-print/agent/ack" -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 15;break } catch { Start-Sleep -Seconds 3 }
    }
   }
  } catch { Write-Warning 'Printer connection interrupted; waiting to reconnect.' }
  Start-Sleep -Seconds 2
 }
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }
