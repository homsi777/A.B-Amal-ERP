$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Homsi\Desktop\نظام-إدارة-مستودعات-الأقمشة-(erp)"
$envFile = Join-Path "C:\Users\Homsi\Desktop\نظام-إدارة-مستودعات-الأقمشة-(erp)" 'server/.env'
$raw = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $raw) { throw 'DATABASE_URL missing' }
$url = $raw.Substring('DATABASE_URL='.Length).Trim()
$uri = [System.Uri]$url
$builder = [System.UriBuilder]::new($uri)
$builder.Port = 5432
$env:DATABASE_URL = $builder.Uri.AbsoluteUri
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run electron:dev *> tmp/electron-dev-localdb.log
