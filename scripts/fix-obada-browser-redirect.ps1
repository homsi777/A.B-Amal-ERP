# Fix Obada :2730 opening abooerp.org — runs fix script on VPS via plink.

$ErrorActionPreference = 'Stop'

$VpsHost = if ($env:OBADA_PUBLIC_HOST) { $env:OBADA_PUBLIC_HOST } else { '65.21.136.217' }
$SshPort = 2727
$SshUser = 'ubuntu'
$SshPassword = '***REMOVED***'
$HostKey = 'ssh-ed25519 SHA256:YbT6Dfpg8rlZ0HT6QR4l6dzh/qfpluOPtTGWTaoeQOw'

function Find-Plink {
  $cmd = Get-Command plink -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
      "${env:ProgramFiles}\PuTTY\plink.exe",
      "${env:ProgramFiles(x86)}\PuTTY\plink.exe"
    )) {
    if (Test-Path $p) { return $p }
  }
  throw 'plink.exe not found — install PuTTY.'
}

$plink = Find-Plink
$remote = 'set -e; if [ -d ~/obada ]; then cd ~/obada; else cd /home/ubuntu/obada; fi; chmod +x scripts/fix-obada-browser-redirect.sh; ./scripts/fix-obada-browser-redirect.sh'

Write-Host ">> Connecting to ${VpsHost}:${SshPort} and fixing Obada nginx ..."
& $plink -batch -ssh -P $SshPort -l $SshUser -pw $SshPassword -hostkey $HostKey $VpsHost $remote

Write-Host ""
Write-Host ">> Open in browser: http://${VpsHost}:2730/"
