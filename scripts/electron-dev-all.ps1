# Windows tunnel + DB check + full stack (vps-connection.json + dev-stack).
# npm script: electron:dev:windows-tunnel
# Override VPS: FABRIC_VPS_HOST | SSH user: FABRIC_VPS_SSH_USER (default ubuntu)
# Override SSH password: FABRIC_VPS_SSH_PASSWORD (otherwise uses $script:CLOTEX_VPS_SSH_PASSWORD below).
#
# SECURITY: Rotate VPS password after testing; do not commit a file containing secrets to a public repo.

param([string]$VpsHost)

$ErrorActionPreference = 'Stop'

# --- يمكنك تغيير كلمة المرور هنا أو عبر FABRIC_VPS_SSH_PASSWORD ---
$script:CLOTEX_VPS_SSH_PASSWORD = '700210ww'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location -LiteralPath $repoRoot

$localTunnelPort = 5433
$sshPort = 2727
$sshUser = if ($env:FABRIC_VPS_SSH_USER) { $env:FABRIC_VPS_SSH_USER } else { 'ubuntu' }
$targetHost = if ($VpsHost) { $VpsHost } elseif ($env:FABRIC_VPS_HOST) { $env:FABRIC_VPS_HOST } else { '65.21.136.217' }
$plainPassword = if ($env:FABRIC_VPS_SSH_PASSWORD) { $env:FABRIC_VPS_SSH_PASSWORD } elseif ($script:CLOTEX_VPS_SSH_PASSWORD) { $script:CLOTEX_VPS_SSH_PASSWORD } else { '' }

function Test-PortOpen([int]$Port) {
  try {
    $c = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
    return $c.TcpTestSucceeded
  } catch {
    return $false
  }
}

function Find-SshPass {
  foreach ($rel in @(
      "${env:ProgramFiles}\Git\usr\bin\sshpass.exe",
      "${env:ProgramFiles(x86)}\Git\usr\bin\sshpass.exe"
    )) {
    if ($rel -and (Test-Path -LiteralPath $rel)) { return $rel }
  }
  $cmd = Get-Command sshpass -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Find-Plink {
  $beside = Join-Path $PSScriptRoot 'plink.exe'
  if (Test-Path -LiteralPath $beside) { return $beside }
  $cmd = Get-Command plink -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($rel in @(
      "${env:ProgramFiles}\PuTTY\plink.exe",
      "${env:ProgramFiles(x86)}\PuTTY\plink.exe",
      "${env:ChocolateyInstall}\lib\putty\tools\plink.exe"
    )) {
    if ($rel -and (Test-Path -LiteralPath $rel)) { return $rel }
  }
  return $null
}

function Start-BackgroundTunnelWithPassword {
  param([string]$Password)

  $sshBin = (Get-Command ssh -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
  if (-not $sshBin) { return $false }

  $sshpass = Find-SshPass
  if ($sshpass) {
    $args = @(
      '-p', $Password,
      $sshBin,
      '-N',
      '-p', "$sshPort",
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-L', "${localTunnelPort}:127.0.0.1:5432",
      "${sshUser}@${targetHost}"
    )
    Start-Process -FilePath $sshpass -ArgumentList $args -WindowStyle Hidden | Out-Null
    return $true
  }

  $plink = Find-Plink
  if ($plink) {
    # plink: port forward only (-N), password non-interactive (-pw)
    $pArgs = @(
      '-ssh',
      '-N',
      '-P', "$sshPort",
      '-pw', $Password,
      '-L', "${localTunnelPort}:127.0.0.1:5432",
      "${sshUser}@${targetHost}"
    )
    Start-Process -FilePath $plink -ArgumentList $pArgs -WindowStyle Hidden | Out-Null
    return $true
  }

  return $false
}

if (-not (Test-PortOpen $localTunnelPort)) {
  $started = $false
  if ($plainPassword) {
    Write-Host '[electron:dev] Trying non-interactive tunnel (sshpass or plink)...'
    $started = Start-BackgroundTunnelWithPassword -Password $plainPassword
    if (-not $started) {
      Write-Host '[electron:dev] sshpass/plink not found. Install Git (sshpass) or PuTTY (plink), or remove password from script and use interactive window.'
      Write-Host '[electron:dev] Falling back to interactive SSH window...'
    }
  }

  if (-not $started) {
    $sshExe = Get-Command ssh -ErrorAction SilentlyContinue
    if (-not $sshExe) {
      Write-Host '[electron:dev] ssh not found in PATH.'
      exit 1
    }
    Write-Host ''
    Write-Host '[electron:dev] Opening SSH in a NEW window — enter password there. Leave it open while you work.'
    Write-Host "[electron:dev] ${sshUser}@${targetHost} port ${sshPort}"
    Write-Host ''
    $argList = @(
      '-p', "$sshPort",
      '-L', "${localTunnelPort}:127.0.0.1:5432",
      "${sshUser}@${targetHost}"
    )
    Start-Process -FilePath $sshExe.Source -ArgumentList $argList -WindowStyle Normal
  }

  $deadline = (Get-Date).AddSeconds(120)
  Write-Host '[electron:dev] Waiting for tunnel on 127.0.0.1:5433 (up to 120s)...'
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $localTunnelPort) { break }
    Start-Sleep -Milliseconds 500
  }
  Write-Host ''

  if (-not (Test-PortOpen $localTunnelPort)) {
    Write-Host '[electron:dev] Timeout: tunnel not ready. Check SSH/plink window or FABRIC_VPS_HOST.'
    exit 1
  }
  Write-Host '[electron:dev] Tunnel ready.'
}

Write-Host '[electron:dev] db:tunnel:check ...'
& npm run db:tunnel:check
if ($LASTEXITCODE -ne 0) {
  Write-Host '[electron:dev] Database check failed. Ensure server/.env DATABASE_URL -> 127.0.0.1:5433.'
  exit 1
}

Write-Host '[electron:dev] Starting electron:dev:stack ...'
& npm run electron:dev:stack
