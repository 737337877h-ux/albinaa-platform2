Add-Type -AssemblyName System.Drawing

# Shared by the Windows printer and the offline preview. All geometry is in mm.
function Draw-BarcodeLabel {
 param([Drawing.Graphics]$Graphics, $Label)
 $g=$Graphics
 $width=[single]$Label.widthMm; $height=[single]$Label.heightMm
 $contentWidth=$width-4
 $g.PageUnit=[Drawing.GraphicsUnit]::Millimeter
 $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::None
 $g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
 $fmt=New-Object Drawing.StringFormat
 $fmt.Alignment=[Drawing.StringAlignment]::Center
 $fmt.FormatFlags=[Drawing.StringFormatFlags]::DirectionRightToLeft
 $fmt.Trimming=[Drawing.StringTrimming]::None
 $font=$null; $codeFont=New-Object Drawing.Font('Tahoma',8)
 try {
  $top=[single]1.2; $bottom=$height-1.2
  # Keep the footer separate, so future price content can have its own measured row.
  $codeHeight=0; $codeTop=$bottom
  if ($Label.showCode) {
   $codeHeight=$g.MeasureString([string]$Label.itemCode,$codeFont).Height+0.6
   $codeTop=$bottom-$codeHeight
   $bottom=$codeTop-1
  }
  $nameHeight=0; $nameSize=8
  if ($Label.showName) {
   $available=$bottom-$top-1.2-8 # Preserve at least 8 mm of barcode bars.
   $fits=$false
   for ($size=8; $size -ge 6; $size-=0.25) {
    if ($font) { $font.Dispose() }
    $font=New-Object Drawing.Font('Tahoma',[single]$size)
    $measured=$g.MeasureString([string]$Label.itemName,$font,[Drawing.SizeF]::new($contentWidth,1000),$fmt)
    $nameHeight=$measured.Height+0.8
    if ($nameHeight -le $available) { $nameSize=$size; $fits=$true; break }
   }
   if (-not $fits) { throw 'Full item name does not fit this label; increase label size.' }
   $top+= $nameHeight+1.2
  }
  $dots=[math]::Floor($contentWidth*203/25.4/($Label.bits.Length+20))
  if ($dots -lt 2) { throw 'Barcode width is too small' }
  $module=$dots*25.4/203
  $x=($width-$Label.bits.Length*$module)/2
  # A taller label must not stretch the bars through the whole remaining page.
  # Keep the code with the barcode; the free space below can later host a price row.
  $preferredBarHeight=[math]::Max(8,[math]::Min(18,$height*0.4))
  $barHeight=[math]::Min($bottom-$top,$preferredBarHeight)
  if ($barHeight -lt 8) { throw 'Label height is too small' }
  if ($Label.showCode) { $codeTop=$top+$barHeight+1 }
  # Validate all rows before drawing anything onto the physical page.
  if ($Label.showName) {
   $g.DrawString([string]$Label.itemName,$font,[Drawing.Brushes]::Black,[Drawing.RectangleF]::new(2,1.2,$contentWidth,$nameHeight),$fmt)
  }
  for ($i=0; $i -lt $Label.bits.Length; $i++) {
   if ($Label.bits[$i] -eq '1') { $g.FillRectangle([Drawing.Brushes]::Black,[single]($x+$i*$module),[single]$top,[single]$module,[single]$barHeight) }
  }
  if ($Label.showCode) {
   $fmt.FormatFlags=0
   $g.DrawString([string]$Label.itemCode,$codeFont,[Drawing.Brushes]::Black,[Drawing.RectangleF]::new(2,$codeTop,$contentWidth,$codeHeight),$fmt)
  }
  return [pscustomobject]@{NameHeight=$nameHeight;NameFontSize=$nameSize;BarcodeTop=$top;BarcodeHeight=$barHeight;CodeTop=$codeTop;ModuleDots=$dots}
 } finally { if ($font) {$font.Dispose()}; $codeFont.Dispose(); $fmt.Dispose() }
}
