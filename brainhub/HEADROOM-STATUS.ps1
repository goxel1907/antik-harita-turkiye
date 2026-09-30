param([int]$Port = 8788)
$ErrorActionPreference = 'Stop'
try {
  $r = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -TimeoutSec 4
  Write-Host ("HEADROOM_OK port={0} status={1} optimize={2}" -f $Port,$r.status,$r.optimize) -ForegroundColor Green
  if ($r.stats) { $r.stats | Format-List }
} catch {
  Write-Host "HEADROOM_UNAVAILABLE port=$Port $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host '9Router RTK yine kullanilabilir. Headroom icin HEADROOM-SETUP.ps1 -Install calistirin ve 9Router URL=8788 yapin.'
  exit 2
}
