@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 18 or later: https://nodejs.org
  pause
  exit /b 1
)
echo KK Mahjong - http://localhost:5173
node server.js
pause
