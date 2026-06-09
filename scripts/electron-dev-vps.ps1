# Compatible wrapper — real flow is: npm run electron:dev:vps (auto SSH via ssh2/plink + db check + stack)
$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location -LiteralPath $repoRoot
& npm run electron:dev:vps
