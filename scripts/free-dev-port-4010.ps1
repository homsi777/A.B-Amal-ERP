# يحرِّر المنفذ 4010 على Windows لبيئة التطوير
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$Port = 4010

$pids = @()
try {
  $found = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
    Select-Object -ExpandProperty OwningProcess -Unique
  $pids = @($found)
} catch {
  $raw = netstat -ano | Select-String ":$Port\s.*LISTENING"
  foreach ($line in $raw) {
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
    $last = $parts[$parts.Length - 1]
    if ($last -match '^\d+$') { $pids += [int]$last }
  }
  $pids = @($pids | Select-Object -Unique)
}

if (@($pids).Count -eq 0) {
  Write-Host '[free-port] المنفذ' $Port 'غير مستخدم — لا حاجة لإيقاف شيء.'
  exit 0
}

foreach ($procId in $pids) {
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    Write-Host "[free-port] إيقاف PID $procId ($($p.ProcessName)) على المنفذ $Port"
    Stop-Process -Id $procId -Force -ErrorAction Stop
  } catch {
    Write-Warning "[free-port] تعذّر إيقاف PID ${procId}: $($_.Exception.Message)"
  }
}

Write-Host '[free-port] تم. يمكنك الآن تشغيل npm run electron:dev:stack'
exit 0
