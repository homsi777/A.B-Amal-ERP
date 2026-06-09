#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')
Set-Location -LiteralPath $root.Path

Write-Host '[electron:clean:artifacts] Stopping Clotex-ERP...'
try {
  Get-Process -Name 'Clotex-ERP' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch { }

$targets = @(
  (Join-Path $root.Path 'dist'),
  (Join-Path $root.Path 'server-bundle'),
  (Join-Path $root.Path 'electron-dist'),
  (Join-Path $root.Path 'release')
)

foreach ($dir in $targets) {
  if (-not (Test-Path -LiteralPath $dir)) {
    Write-Host "[electron:clean:artifacts] skip (missing): $dir"
    continue
  }
  Write-Host "[electron:clean:artifacts] removing: $dir"
  try {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Host "[electron:clean:artifacts] FAILED: $dir - close the app and Explorer windows inside it, then retry." -ForegroundColor Red
    exit 1
  }
}

Write-Host '[electron:clean:artifacts] done.'
exit 0
