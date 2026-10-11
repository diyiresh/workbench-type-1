@echo off
setlocal
cd /d "%~dp0"
node "%~dp0scripts/workbuddy-login.js" %*
if errorlevel 1 echo Login launcher failed. Please send the error shown above.
pause
