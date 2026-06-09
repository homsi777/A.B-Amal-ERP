#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')
$releaseDir = Join-Path $root.Path 'release'
$winUnpacked = Join-Path $releaseDir 'win-unpacked'

Write-Host "[electron:clean] releaseDir = $releaseDir"

try {
  Get-Process -Name 'Clotex-ERP' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch { }

try {
  Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      if ($null -ne $_.Path -and $_.Path.StartsWith($winUnpacked, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  }
} catch { }

if (Test-Path -LiteralPath $winUnpacked) {
  Write-Host "[electron:clean] Removing $winUnpacked"
  try {
    Remove-Item -LiteralPath $winUnpacked -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Host ""
    Write-Host "[electron:clean] Failed to remove win-unpacked because a file is in use." -ForegroundColor Red
    Write-Host "[electron:clean] Close the running app/preview and close any Explorer window opened inside release\\win-unpacked, then retry." -ForegroundColor Yellow
    Write-Host "[electron:clean] If it still fails, reboot Windows and try again." -ForegroundColor Yellow
    exit 1
  }
}

exit 0
