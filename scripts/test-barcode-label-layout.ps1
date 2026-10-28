param([Parameter(Mandatory=$true)][string]$SampleJson,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'barcode-label-layout.ps1')
$label=Get-Content -LiteralPath $SampleJson -Raw -Encoding UTF8 | ConvertFrom-Json
$null=New-Item -ItemType Directory -Force -Path $OutputDirectory
$results=@()
foreach ($size in @(@(60,40),@(50,30),@(50,25),@(40,25))) {
 foreach ($dpi in @(203,300)) {
  $label.widthMm=$size[0]; $label.heightMm=$size[1]
  $bitmap=New-Object Drawing.Bitmap([int][math]::Ceiling($size[0]*$dpi/25.4),[int][math]::Ceiling($size[1]*$dpi/25.4))
  $bitmap.SetResolution($dpi,$dpi)
  $g=[Drawing.Graphics]::FromImage($bitmap)
  try {
   $g.Clear([Drawing.Color]::White)
   $layout=Draw-BarcodeLabel -Graphics $g -Label $label
   if ($layout.BarcodeTop -lt (1.2+$layout.NameHeight+1) -or $layout.BarcodeHeight -lt 8 -or ($layout.BarcodeTop+$layout.BarcodeHeight) -gt ($layout.CodeTop-0.9)) { throw 'Rows overlap' }
   $path=Join-Path $OutputDirectory ("label-{0}x{1}-{2}dpi.png" -f $size[0],$size[1],$dpi)
   $bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png)
   $results += [pscustomobject]@{Size=($size -join 'x');Dpi=$dpi;Layout=$layout;Preview=$path}
  } finally { $g.Dispose(); $bitmap.Dispose() }
 }
}
# Hidden rows must not render; bar height stays bounded and impossible names fail.
$bitmap=New-Object Drawing.Bitmap(400,240);$bitmap.SetResolution(203,203)
$g=[Drawing.Graphics]::FromImage($bitmap)
try {
 $label.widthMm=50;$label.heightMm=30;$label.showName=$false;$label.showCode=$false
 $layout=Draw-BarcodeLabel -Graphics $g -Label $label
 if ([math]::Abs($layout.BarcodeTop-1.2) -gt 0.001 -or [math]::Abs($layout.BarcodeHeight-12) -gt 0.001) { throw 'Hidden rows or barcode height incorrect' }
 $label.widthMm=60;$label.heightMm=40;$label.showName=$true
 $layout=Draw-BarcodeLabel -Graphics $g -Label $label
 if ([math]::Abs($layout.BarcodeHeight-16) -gt 0.001) { throw '60x40 barcode stretched with hidden code' }
 $label.showCode=$true
 $layout=Draw-BarcodeLabel -Graphics $g -Label $label
 if ([math]::Abs($layout.BarcodeHeight-16) -gt 0.001 -or [math]::Abs($layout.CodeTop-$layout.BarcodeTop-$layout.BarcodeHeight-1) -gt 0.001) { throw 'Code must follow bars with a 1 mm gap' }
 $label.widthMm=50;$label.heightMm=30
 $label.showName=$true;$label.showCode=$true;$label.itemName=('long item name ' * 100)
 $rejected=$false
 try { $null=Draw-BarcodeLabel -Graphics $g -Label $label } catch { if ($_.Exception.Message -like '*Full item name*') { $rejected=$true } else { throw } }
 if (-not $rejected) { throw 'Oversized name was not rejected' }
} finally { $g.Dispose();$bitmap.Dispose() }
$results | ConvertTo-Json -Depth 4
