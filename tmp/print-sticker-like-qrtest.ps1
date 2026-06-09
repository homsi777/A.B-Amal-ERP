Add-Type -AssemblyName System.Drawing

$printerName = "Xprinter XP-480B"
$barcodeValue = "30367550"
$qrValue = "VISKON KETEN|ANKA-01|KASAR|11|LOT 1|125.00|35.20"

$tempDir = Join-Path $env:TEMP "xp480b_label_test"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$qrPath = Join-Path $tempDir "qr.png"
$bcPath = Join-Path $tempDir "barcode.png"

Invoke-WebRequest -Uri ("https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + [uri]::EscapeDataString($qrValue)) -OutFile $qrPath
Invoke-WebRequest -Uri ("https://bwipjs-api.metafloor.com/?bcid=code128&text=" + [uri]::EscapeDataString($barcodeValue) + "&scale=3&height=18&includetext=false") -OutFile $bcPath

$qrImg = [System.Drawing.Image]::FromFile($qrPath)
$bcImg = [System.Drawing.Image]::FromFile($bcPath)

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName
if (-not $doc.PrinterSettings.IsValid) { throw "Printer '$printerName' not available." }

$doc.DocumentName = "Sticker_like_QR_test_" + (Get-Date -Format "yyyyMMdd_HHmmss")
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$doc.DefaultPageSettings.Landscape = $true

# For many label drivers, setting base size 80x100 with Landscape=true
# yields final physical output 100x80 in the correct horizontal orientation.
# 80mm ~= 315, 100mm ~= 394
$paper80x100 = New-Object System.Drawing.Printing.PaperSize("Label_80x100mm_Base", 315, 394)
$doc.DefaultPageSettings.PaperSize = $paper80x100

$fTitle = New-Object System.Drawing.Font("Arial", 26, [System.Drawing.FontStyle]::Bold)
$fSub = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Regular)
$fLbl = New-Object System.Drawing.Font("Arial", 9.5, [System.Drawing.FontStyle]::Regular)
$fVal = New-Object System.Drawing.Font("Arial", 9.5, [System.Drawing.FontStyle]::Bold)
$fNum = New-Object System.Drawing.Font("Arial", 10.5, [System.Drawing.FontStyle]::Bold)
$fFoot = New-Object System.Drawing.Font("Arial", 8, [System.Drawing.FontStyle]::Bold)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1.2)

$doc.add_PrintPage({
  param($s, $e)
  $g = $e.Graphics
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $b = $e.MarginBounds
  if ($b.Width -le 0 -or $b.Height -le 0) { $b = $e.PageBounds }
  # Strong inner safe area to avoid XP-480B unprintable-edge clipping.
  $safe = 18
  $x = $b.X + $safe
  $y = $b.Y + $safe
  $w = $b.Width - ($safe * 2)
  $h = $b.Height - ($safe * 2)

  # Draw everything in a virtual canvas and scale it down to fit safely.
  $virtualW = 560.0
  $virtualH = 410.0
  $scale = [Math]::Min($w / $virtualW, $h / $virtualH) * 1.00
  $originX = $x + (($w - ($virtualW * $scale)) / 2)
  $originY = $y + (($h - ($virtualH * $scale)) / 2)

  $g.TranslateTransform([float]$originX, [float]$originY)
  $g.ScaleTransform([float]$scale, [float]$scale)

  # Header
  $g.DrawString("TEXTORIA", $fTitle, [System.Drawing.Brushes]::Black, 145, 0)
  $g.DrawString("CLOTHES TEXTILE", $fSub, [System.Drawing.Brushes]::Black, 175, 40)
  $g.DrawLine($pen, 0, 60, 560, 60)

  # Top fields
  $g.DrawString("Order Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 68)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 68)
  $g.DrawString("Customer P / O", $fLbl, [System.Drawing.Brushes]::Black, 2, 89)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 89)
  $g.DrawLine($pen, 0, 111, 560, 111)

  # Middle block
  $g.DrawString("Article Code", $fLbl, [System.Drawing.Brushes]::Black, 2, 118)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 118)
  $g.DrawString("VISKON KETEN", $fVal, [System.Drawing.Brushes]::Black, 140, 118)

  $g.DrawString("Design Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 139)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 139)
  $g.DrawString("ANKA-01", $fVal, [System.Drawing.Brushes]::Black, 140, 139)
  $g.DrawString("Colour Cd : 11", $fVal, [System.Drawing.Brushes]::Black, 338, 139)

  $g.DrawString("Colour Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 160)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 160)
  $g.DrawString("KASAR", $fVal, [System.Drawing.Brushes]::Black, 140, 160)
  $g.DrawLine($pen, 0, 182, 560, 182)

  # Bottom left
  $g.DrawString("Note", $fLbl, [System.Drawing.Brushes]::Black, 2, 190)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 190)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 140, 190)

  $g.DrawString("Lot Nr", $fLbl, [System.Drawing.Brushes]::Black, 2, 214)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 214)
  $g.DrawString("LOT 1", $fVal, [System.Drawing.Brushes]::Black, 140, 214)

  $g.DrawString("Meters", $fLbl, [System.Drawing.Brushes]::Black, 2, 238)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 238)
  $g.DrawString("125,00  MTS.", $fNum, [System.Drawing.Brushes]::Black, 140, 236)

  $g.DrawString("Net Weight", $fLbl, [System.Drawing.Brushes]::Black, 2, 270)
  $g.DrawString(":", $fLbl, [System.Drawing.Brushes]::Black, 120, 270)
  $g.DrawString("35,20   KGS.", $fNum, [System.Drawing.Brushes]::Black, 140, 268)
  $g.DrawLine($pen, 2, 293, 300, 293)

  # Quality + QR
  $g.DrawString("QUALITY :", $fVal, [System.Drawing.Brushes]::Black, 360, 190)
  $g.DrawString("1", $fVal, [System.Drawing.Brushes]::Black, 360, 214)
  $g.DrawImage($qrImg, 346, 228, 126, 126)

  # Barcode + footer
  $g.DrawImage($bcImg, 90, 304, 170, 52)
  $g.DrawString("30367550", $fNum, [System.Drawing.Brushes]::Black, 112, 353)
  $g.DrawString("THE CLAIMS WILL NOT ACCEPTABLE AFTER THE GOODS WERE CUT", $fFoot, [System.Drawing.Brushes]::Black, 35, 380)

  $e.HasMorePages = $false
})

$doc.Print()
$qrImg.Dispose()
$bcImg.Dispose()

Write-Output ("PRINT_SENT|Printer=" + $doc.PrinterSettings.PrinterName + "|Doc=" + $doc.DocumentName)
