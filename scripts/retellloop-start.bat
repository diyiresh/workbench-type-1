@echo off
REM Workbench-local copy of RetellLoop silent entry (canonical target remains Happy-family scripts\start-dev.bat).
setlocal
cd /d "%~dp0" || exit /b 1
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0retellloop-start-silent.ps1"
exit /b 0
