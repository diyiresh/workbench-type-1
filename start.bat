@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  统筹工作台  v0.1
echo  打开浏览器: http://127.0.0.1:3780
echo  关掉本窗口即停止服务（数据已写入 data/store.json）
echo.

REM 先识别已经运行的工作台，避免重复启动导致 EADDRINUSE。
curl.exe -fsS --max-time 2 http://127.0.0.1:3780/api/health >nul 2>&1
if not errorlevel 1 (
  echo  工作台已经在运行，正在打开浏览器。
  start "" "http://127.0.0.1:3780"
  exit /b 0
)

REM 健康检查失败但端口已被占用时，给出准确提示而不是误报 Node.js 缺失。
netstat -ano | findstr /c:":3780 " | findstr /c:"LISTENING" >nul
if not errorlevel 1 (
  echo  端口 3780 已被其他程序占用，且不是可用的工作台服务。
  echo  请关闭占用该端口的程序后再启动。
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo  未检测到 Node.js。请安装 Node.js 后重新双击 start.bat。
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3780"
node server.js
if errorlevel 1 (
  echo.
  echo  工作台未能启动。请查看上方错误信息。
  pause
)
