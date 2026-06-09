Add-Type -AssemblyName System.Drawing

$printerName = "Xprinter XP-480B"
$labels = @(
  @{
    Article = "VISKON KETEN"; Design = "ANKA-01"; Colour = "KASAR"; ColourCode = "11";
    Lot = "LOT 1"; Meters = "125.00"; Weight = "35.20"; Barcode = "30367550"; Quality = "1"
  },
  @{
    Article = "SOFT SATEN"; Design = "ST-440"; Colour = "IVORY"; ColourCode = "02";
    Lot = "LOT 2"; Meters = "120.40"; Weight = "32.10"; Barcode = "30367551"; Quality = "1"
  },
  @{
    Article = "LONDRA"; Design = "KL-131"; Colour = "RED"; ColourCode = "03";
    Lot = "LOT 3"; Meters = "100.00"; Weight = "28.50"; Barcode = "30367552"; Quality = "1"
  }
)

$tempDir = Join-Path $env:TEMP "xp480b_multi_label_test"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

foreach ($label in $labels) {
  $label.QrValue = "$($label.Article)|$($label.Design)|$($label.Colour)|$($label.ColourCode)|$($label.Lot)|$($label.Meters)|$($label.Weight)"
  $safeName = ($label.Barcode -replace '[^\w\-]', '_')
  $label.QrPath = Join-Path $tempDir "qr_$safeName.png"
  $label.BarcodePath = Join-Path $tempDir "barcode_$safeName.png"
  Invoke-WebRequest -Uri ("https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=" + [uri]::EscapeDataString($label.QrValue)) -OutFile $label.QrPath
  Invoke-WebRequest -Uri ("https://bwipjs-api.metafloor.com/?bcid=code128&text=" + [uri]::EscapeDataString($label.Barcode) + "&scale=3&height=18&includetext=false") -OutFile $label.BarcodePath
  $label.QrImg = [System.Drawing.Image]::FromFile($label.QrPath)
  $label.BarcodeImg = [System.Drawing.Image]::FromFile($label.BarcodePath)
}

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName
if (-not $doc.PrinterSettings.IsValid) { throw "Printer '$printerName' not available." }

$doc.DocumentName = "ERP_multi_test_stickers_" + (Get-Date -Format "yyyyMMdd_HHmmss")
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$doc.DefaultPageSettings.Landscape = $true
$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Label_80x100mm_Base", 315, 394)

$fTitle = New-Object System.Drawing.Font("Arial", 26, [System.Drawing.FontStyle]::Bold)
$fSub = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Regular)
$fLbl = New-Object System.Drawing.Font("Arial", 9.5, [System.Drawing.FontStyle]::Regular)
$fVal = New-Object System.Drawing.Font("Arial", 9.5, [System.Drawing.FontStyle]::Bold)
$fNum = New-Object System.Drawing.Font("Arial", 10.5, [System.Drawing.FontStyle]::Bold)
$fFoot = New-Object System.Drawing.Font("Arial", 8, [System.Drawing.FontStyle]::Bold)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1.2)
$pageIndex = 0

$doc.add_PrintPage({
  param($s, $e)
  $label = $labels[$script:pageIndex]
  $g = $e.Graphics
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $b = $e.MarginBounds
  if ($b.Width -le 0 -or $b.Height -le 0) { $b = $e.PageBounds }
  $safe = 18
  $x = $b.X + $safe
  $y = $b.Y + $safe
  $w = $b.Width - ($safe * 2)
  $h = $b.Height - ($safe * 2)

  $virtualW = 560.0
  $virtualH = 410.0
  $scale = [Math]::Min($w / $virtualW, $h / $virtualH)
  $originX = $x + (($w - ($virtualW * $scale)) / 2)
  $originY = $y + (($h - ($virtualH * $scale)) / 2)
  $g.TranslateTransform([float]$originX, [float]$originY)
  $g.ScaleTransform([float]$scale, [float]$scale)

  $g.DrawString("TEXTORIA", $fTitle, [System.Drawing.Brushes]::Black, 145, 0)
  $g.DrawString("CLOTHES TEXTILE", $fSub, [System.Drawing.Brushes]::Black, 175, 40)
  $g.DrawLine($pen, 0, 60, 560, 60)

  $g.DrawString("Order Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 68)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 68)
  $g.DrawString("Customer P / O", $fLbl, [System.Drawing.Brushes]::Black, 2, 89)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 89)
  $g.DrawLine($pen, 0, 111, 560, 111)

  $g.DrawString("Article Code", $fLbl, [System.Drawing.Brushes]::Black, 2, 118)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 118)
  $g.DrawString($label.Article, $fVal, [System.Drawing.Brushes]::Black, 140, 118)
  $g.DrawString("Design Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 139)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 139)
  $g.DrawString($label.Design, $fVal, [System.Drawing.Brushes]::Black, 140, 139)
  $g.DrawString(("Colour Cd : " + $label.ColourCode), $fVal, [System.Drawing.Brushes]::Black, 338, 139)
  $g.DrawString("Colour Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 160)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 160)
  $g.DrawString($label.Colour, $fVal, [System.Drawing.Brushes]::Black, 140, 160)
  $g.DrawLine($pen, 0, 182, 560, 182)

  $g.DrawString("Note", $fLbl, [System.Drawing.Brushes]::Black, 2, 190)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 190)
  $g.DrawString("Lot Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 214)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 214)
  $g.DrawString($label.Lot, $fVal, [System.Drawing.Brushes]::Black, 140, 214)
  $g.DrawString("Meters", $fLbl, [System.Drawing.Brushes]::Black, 2, 238)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 238)
  $g.DrawString(($label.Meters.Replace(".", ",") + "  MTS."), $fNum, [System.Drawing.Brushes]::Black, 140, 236)
  $g.DrawString("Net Weight", $fLbl, [System.Drawing.Brushes]::Black, 2, 270)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 270)
  $g.DrawString(($label.Weight.Replace(".", ",") + "   KGS."), $fNum, [System.Drawing.Brushes]::Black, 140, 268)
  $g.DrawLine($pen, 2, 293, 300, 293)

  $g.DrawString("QUALITY :", $fVal, [System.Drawing.Brushes]::Black, 360, 190)
  $g.DrawString($label.Quality, $fVal, [System.Drawing.Brushes]::Black, 360, 214)
  $g.DrawImage($label.QrImg, 346, 228, 126, 126)

  $g.DrawImage($label.BarcodeImg, 90, 304, 170, 52)
  $g.DrawString($label.Barcode, $fNum, [System.Drawing.Brushes]::Black, 112, 353)
  $g.DrawString("THE CLAIMS WILL NOT ACCEPTABLE AFTER THE GOODS WERE CUT", $fFoot, [System.Drawing.Brushes]::Black, 35, 380)

  $script:pageIndex += 1
  $e.HasMorePages = $script:pageIndex -lt $labels.Count
})

$doc.Print()

foreach ($label in $labels) {
  $label.QrImg.Dispose()
  $label.BarcodeImg.Dispose()
}

Write-Output ("PRINT_SENT|Printer=" + $doc.PrinterSettings.PrinterName + "|Doc=" + $doc.DocumentName + "|Labels=" + $labels.Count)
foreach ($label in $labels) {
  Write-Output ("LABEL|" + $label.Barcode + "|" + $label.QrValue)
}
