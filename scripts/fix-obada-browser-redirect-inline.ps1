# One-shot VPS fix — no repo script required on server (inline nginx + reload).

$ErrorActionPreference = 'Stop'

$VpsHost = if ($env:OBADA_PUBLIC_HOST) { $env:OBADA_PUBLIC_HOST } else { '65.21.136.217' }
$WebPort = if ($env:OBADA_WEB_PORT) { $env:OBADA_WEB_PORT } else { '2730' }
$ApiPort = if ($env:OBADA_API_PORT) { $env:OBADA_API_PORT } else { '4030' }
$NatPort = if ($env:OBADA_NAT_INTERNAL_PORT) { $env:OBADA_NAT_INTERNAL_PORT } else { '3000' }
$NginxRoot = if ($env:OBADA_NGINX_ROOT) { $env:OBADA_NGINX_ROOT } else { '/var/www/obada/frontend' }
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

$remote = @'
set -e
SITE=/etc/nginx/sites-available/obada-ip-3000
sudo tee "$SITE" >/dev/null <<'NGINXEOF'
server {
    listen NATPORT default_server;
    server_name VPSHOST _;

    root NGINXROOT;
    index index.html;

    client_max_body_size 50m;

    location ^~ /api/api/ {
        proxy_pass http://127.0.0.1:APIPORT/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:APIPORT/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF
sudo sed -i "s|NATPORT|NATPORT_VAL|g; s|VPSHOST|VPSHOST_VAL|g; s|NGINXROOT|NGINXROOT_VAL|g; s|APIPORT|APIPORT_VAL|g" "$SITE"
sudo ln -sf "$SITE" /etc/nginx/sites-enabled/obada-ip-3000
for f in /etc/nginx/sites-enabled/* /etc/nginx/sites-available/*; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  [ "$base" = obada-ip-3000 ] && continue
  if grep -q "listen[[:space:]]+NATPORT_VAL\b" "$f" 2>/dev/null && grep -q default_server "$f" 2>/dev/null; then
    echo "strip default_server from $base"
    sudo sed -i "s/listen[[:space:]]+NATPORT_VAL\([^;]*\)[[:space:]]*default_server/listen NATPORT_VAL\1/g" "$f"
    sudo sed -i "s/default_server[[:space:]]*;//g" "$f"
  fi
done
sudo nginx -t
sudo systemctl reload nginx
curl -sf -H "Host: VPSHOST_VAL" http://127.0.0.1:NATPORT_VAL/api/health/live | head -c 200 || echo HEALTH_FAIL
echo
echo DONE
'@

$remote = $remote.Replace('NATPORT_VAL', $NatPort)
$remote = $remote.Replace('VPSHOST_VAL', $VpsHost)
$remote = $remote.Replace('NGINXROOT_VAL', $NginxRoot)
$remote = $remote.Replace('APIPORT_VAL', $ApiPort)

$plink = Find-Plink
Write-Host ">> Fixing Obada NAT on ${VpsHost} (external :${WebPort} -> internal :${NatPort}) ..."
& $plink -batch -ssh -P $SshPort -l $SshUser -pw $SshPassword -hostkey $HostKey $VpsHost $remote
Write-Host ">> Try: http://${VpsHost}:${WebPort}/"
