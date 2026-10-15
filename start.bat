@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo cursor-agent-keepalive
echo 推荐日常用法：node scripts/install-workbench-inject.mjs
echo 然后 Cursor 里 Reload Window（右下角 keepalive ON）
echo.
echo 下面是可选 CDP 方案（需调试端口 9222）...
echo.
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
echo Starting CDP keepalive...
call npm start
