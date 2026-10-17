# KK Mahjong - one-click update to the Aliyun server
# Usage (from project root D:\mahjong, in PowerShell):
#   .\deploy\update.ps1
# or double-click the .cmd wrapper in the same folder.
#
# It packages the local runtime files, uploads them, reinstalls on the server,
# and verifies the site from the public network.
# NOTE: restarting the service clears in-memory rooms, so do not update mid-game.
# This file is intentionally ASCII-only: PowerShell 5.1 misreads non-ASCII
# scripts saved without a BOM.

param(
  [string]$Server = '47.122.110.77',
  [string]$Key = "$env:USERPROFILE\.ssh\kk_deploy",
  [int]$Port = 80
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $project 'server.js'))) {
  throw "server.js not found in $project - keep this script inside the project's deploy folder"
}
if (-not (Test-Path $Key)) { throw "SSH private key not found: $Key" }

$rootFiles = @(
  'server.js', 'package.json', 'index.html', 'app.js', 'engine.js',
  'styles.css', 'table-depth.css', 'tiles-depth.css', 'seats-layout.css',
  'laizi.css', 'rooms.css', 'wall-layout.css', 'landscape.css'
)

Write-Host "==> 1/4 Packaging local files" -ForegroundColor Cyan
$stage = Join-Path $env:TEMP ('kk-update-stage-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  foreach ($f in $rootFiles) {
    $src = Join-Path $project $f
    if (-not (Test-Path $src)) { throw "missing file: $f" }
    Copy-Item $src $stage
  }
  foreach ($d in 'src', 'assets') {
    $src = Join-Path $project $d
    if (-not (Test-Path $src)) { throw "missing folder: $d" }
    Copy-Item $src (Join-Path $stage $d) -Recurse
  }
  New-Item -ItemType Directory -Path (Join-Path $stage 'deploy') | Out-Null
  Copy-Item (Join-Path $project 'deploy\install.sh') (Join-Path $stage 'deploy')
  Copy-Item (Join-Path $project 'deploy\Caddyfile.example') (Join-Path $stage 'deploy')

  $tarPath = Join-Path $env:TEMP 'kk-update.tar.gz'
  if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
  tar.exe -czf $tarPath -C $stage .
  if ($LASTEXITCODE -ne 0) { throw 'packaging failed (tar exit code not 0)' }
  Write-Host ("    ok: {0:N0} KB" -f ((Get-Item $tarPath).Length / 1KB)) -ForegroundColor Green

  Write-Host "==> 2/4 Uploading to $Server" -ForegroundColor Cyan
  scp -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no $tarPath "root@${Server}:/opt/kk-update.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'upload failed - check network and key' }
  Write-Host "    ok" -ForegroundColor Green

  Write-Host "==> 3/4 Backup, extract and reinstall on the server" -ForegroundColor Cyan
  $remoteLines = @(
    'set -e',
    'mkdir -p /opt',
    'rm -rf /opt/kk-src-new',
    'mkdir -p /opt/kk-src-new',
    'tar -xzf /opt/kk-update.tar.gz -C /opt/kk-src-new',
    'if [ -d /opt/kk-mahjong ]; then',
    '  ts=$(date +%Y%m%d-%H%M%S)',
    '  tar -czf "/opt/kk-backup-$ts.tar.gz" -C /opt kk-mahjong',
    '  echo "BACKUP=/opt/kk-backup-$ts.tar.gz"',
    'fi',
    'cd /opt/kk-src-new && PORT="$1" bash deploy/install.sh'
  )
  # Send the remote script as a real file (LF endings). Piping it through ssh
  # can turn LF into CRLF and make bash report "No such file or directory".
  $remotePath = Join-Path $env:TEMP 'kk-update-remote.sh'
  [IO.File]::WriteAllText($remotePath, (($remoteLines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
  scp -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no $remotePath "root@${Server}:/opt/kk-update-remote.sh"
  if ($LASTEXITCODE -ne 0) { throw 'failed to upload remote script' }
  ssh -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no "root@$Server" "bash /opt/kk-update-remote.sh $Port"
  if ($LASTEXITCODE -ne 0) { throw 'remote install failed - see the output above' }

  Write-Host "==> 4/4 Public verification" -ForegroundColor Cyan
  $base = if ($Port -eq 80) { "http://$Server" } else { "http://${Server}:$Port" }
  $health = Invoke-WebRequest -UseBasicParsing -Uri "$base/healthz" -TimeoutSec 15
  $index = Invoke-WebRequest -UseBasicParsing -Uri "$base/" -TimeoutSec 15
  if ($health.StatusCode -ne 200 -or $index.StatusCode -ne 200) { throw 'verification failed' }
  Write-Host "    /healthz 200, index 200 ($($index.RawContentLength) bytes)" -ForegroundColor Green

  Write-Host ""
  Write-Host "Update done: $base" -ForegroundColor Green
  Write-Host "Rollback: take the BACKUP= path printed above, then run" -ForegroundColor DarkGray
  Write-Host "  ssh -i `"$Key`" root@$Server `"rm -rf /opt/kk-mahjong && tar -xzf /opt/kk-backup-<ts>.tar.gz -C /opt && systemctl restart kk-mahjong`"" -ForegroundColor DarkGray
}
finally {
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
