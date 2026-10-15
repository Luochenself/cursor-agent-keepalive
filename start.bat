@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Installing deps...
  call npm install
)
echo.
call npm run launch-cursor
if errorlevel 1 exit /b 1
call npm run probe
if errorlevel 1 exit /b 1
echo.
echo Starting keepalive...
call npm start
