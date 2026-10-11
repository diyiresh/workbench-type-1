$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$healthUrl = "http://127.0.0.1:3780/api/health"
$logDir = Join-Path $projectRoot "logs"
$startupLog = Join-Path $logDir "workbench-startup.log"
$stdoutLog = Join-Path $logDir "workbench.stdout.log"
$stderrLog = Join-Path $logDir "workbench.stderr.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-StartupLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $startupLog -Value "[$timestamp] $Message" -Encoding UTF8
}

function Test-WorkbenchHealth {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $response.ok -eq $true
  }
  catch {
    return $false
  }
}

if (Test-WorkbenchHealth) {
  Write-StartupLog "Workbench is already healthy; startup skipped."
  exit 0
}

$portOwner = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 3780 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($portOwner) {
  Write-StartupLog "Port 3780 is occupied by PID $($portOwner.OwningProcess), but the workbench health check failed."
  exit 2
}

$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    Write-StartupLog "Node.js was not found."
    exit 3
  }
  $nodeExe = $nodeCommand.Source
}

Write-StartupLog "Starting workbench with $nodeExe."
Start-Process -FilePath $nodeExe `
  -ArgumentList "server.js" `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog | Out-Null

for ($attempt = 1; $attempt -le 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  if (Test-WorkbenchHealth) {
    Write-StartupLog "Workbench started successfully."
    exit 0
  }
}

Write-StartupLog "Workbench did not become healthy within 10 seconds. Check workbench.stderr.log."
exit 4
