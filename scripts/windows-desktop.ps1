# Creates a Start Menu shortcut for the BEN workbench desktop shell.
# -Autostart also copies it into the current user's Startup folder.
# -Uninstall removes both shortcuts. It does not delete the repository.
param(
  [switch]$Autostart,
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$Startup = [Environment]::GetFolderPath("Startup")
$Name = "统筹工作台.lnk"
$Node = (Get-Command node -ErrorAction Stop).Source

function Remove-Shortcut([string]$Folder) {
  $path = Join-Path $Folder $Name
  if (Test-Path $path) { Remove-Item $path -Force }
}

if ($Uninstall) {
  Remove-Shortcut $StartMenu
  Remove-Shortcut $Startup
  Write-Output "Removed workbench shortcuts."
  return
}

function New-WorkbenchShortcut([string]$Folder) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut((Join-Path $Folder $Name))
  $link.TargetPath = $Node
  $link.Arguments = "scripts/run-desktop.js"
  $link.WorkingDirectory = $Repo
  $link.WindowStyle = 7
  $link.Description = "BEN Workbench"
  $link.Save()
}

New-WorkbenchShortcut $StartMenu
if ($Autostart) { New-WorkbenchShortcut $Startup }
Write-Output "Start Menu shortcut created."
if ($Autostart) { Write-Output "Startup shortcut created." }
