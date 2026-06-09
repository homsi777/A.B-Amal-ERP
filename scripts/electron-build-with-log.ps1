#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

try {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [Console]::OutputEncoding
    } else {
        chcp 65001 | Out-Null
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [Console]::OutputEncoding
    }
} catch { /* ignore */ }

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')
Set-Location -LiteralPath $root.Path

New-Item -ItemType Directory -Force -Path (Join-Path $root.Path 'logs') | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-ddTHHmmss'
$logLatest = Join-Path $root.Path 'logs\electron-build-last.log'
$logStamped = Join-Path $root.Path "logs\electron-build-$stamp.log"

$utf8BomEnc = New-Object System.Text.UTF8Encoding $true
$utf8Enc = New-Object System.Text.UTF8Encoding $false

$header = @"
================================================================================
CLOTEX — electron:build (سجل البناء)
بدء: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zz')
المجلّد: $($root.Path)
================================================================================

"@

[System.IO.File]::WriteAllText($logLatest, $header, $utf8BomEnc)
[System.IO.File]::WriteAllText($logStamped, $header, $utf8BomEnc)

Write-Host "[electron:build:log] Start $(Get-Date -Format o)"
Write-Host "[electron:build:log] Timed log file: $logStamped"
Write-Host "[electron:build:log] Last-run log file: $logLatest"
Write-Host ""

$npmCmd = if ($env:OS -match 'Windows') { 'npm.cmd' } else { 'npm' }
& $npmCmd run electron:build 2>&1 | ForEach-Object {
    $line = if ($null -eq $_) { '' } else { $_.ToString() }
    $chunk = "${line}`r`n"
    [System.IO.File]::AppendAllText($logStamped, $chunk, $utf8Enc)
    [System.IO.File]::AppendAllText($logLatest, $chunk, $utf8Enc)
    $line
}

$exit = $LASTEXITCODE
if ($null -eq $exit) {
    $exit = if ($?) { 0 } else { 1 }
}

$footer = @"

================================================================================
انتهاء: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zz')
كود الخروج تقريبي: $exit
نسخ موسومة: $logStamped
نسخ آخر تشغيل: $logLatest
================================================================================
"@

[System.IO.File]::AppendAllText($logLatest, $footer, $utf8Enc)
[System.IO.File]::AppendAllText($logStamped, $footer, $utf8Enc)

Write-Host ""
Write-Host "[electron:build:log] Finished. Exit code ~ $exit"
Write-Host "[electron:build:log] Open the .log paths above in VS Code / Notepad (UTF-8)."

exit $exit
