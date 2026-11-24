# RetellLoop silent launcher — single instance, no visible console for npm.
# Invoked by scripts\start-dev.bat (workbench external-tools "start" action).
$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "package.json"))) {
  $RepoRoot = "D:\github\Happy-family-happy-English"
}
$Port = 43123
$Url = "http://127.0.0.1:43123"
$LogDir = Join-Path $RepoRoot "logs"
$StdoutLog = Join-Path $LogDir "retell-dev.stdout.log"
$StderrLog = Join-Path $LogDir "retell-dev.stderr.log"
$StartupLog = Join-Path $LogDir "retell-dev-startup.log"

function Write-StartupLog {
  param([string]$Message)
  try {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $StartupLog -Value "[$timestamp] $Message" -Encoding UTF8
  } catch {}
}

function Test-RetellPort {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($conn) { return $true }
  } catch {}
  try {
    $hit = netstat -ano | Select-String -Pattern ":$Port\s+.+LISTENING"
    return [bool]$hit
  } catch {
    return $false
  }
}

function Open-RetellBrowser {
  try { Start-Process $Url | Out-Null } catch {
    try { cmd.exe /c start "" "$Url" | Out-Null } catch {}
  }
}

if (Test-RetellPort) {
  Write-StartupLog "Port $Port already listening; reuse (no second npm). Opening browser."
  Open-RetellBrowser
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "node_modules"))) {
  Write-StartupLog "node_modules missing; running npm install (hidden)..."
  $install = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/d", "/c", "npm.cmd install >> `"$StdoutLog`" 2>> `"$StderrLog`"" `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  if ($install.ExitCode -ne 0) {
    Write-StartupLog "npm install failed with exit $($install.ExitCode). See $StderrLog"
    exit 3
  }
}

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
"" | Set-Content -LiteralPath $StdoutLog -Encoding UTF8
"" | Set-Content -LiteralPath $StderrLog -Encoding UTF8

Write-StartupLog "Starting npm run dev hidden in $RepoRoot"
Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/d", "/c", "npm.cmd run dev >> `"$StdoutLog`" 2>> `"$StderrLog`"" `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden | Out-Null

for ($attempt = 1; $attempt -le 40; $attempt++) {
  Start-Sleep -Milliseconds 500
  if (Test-RetellPort) {
    Write-StartupLog "Port $Port is up after ~$([math]::Round($attempt * 0.5, 1))s. Opening browser."
    Open-RetellBrowser
    exit 0
  }
}

Write-StartupLog "Port $Port did not listen within 20s. Opening browser anyway; check $StderrLog"
Open-RetellBrowser
exit 4
