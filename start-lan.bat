@echo off
rem 手机访问版：把服务开放到局域网。手机连同一个 Wi-Fi 后，
rem 浏览器打开 http://<电脑局域网IP>:3780 （ipconfig 里找 IPv4 地址）
cd /d %~dp0
set HOST=0.0.0.0
node server.js
