@echo off
chcp 65001 >nul
echo Killing Cursor...
taskkill /F /IM Cursor.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Starting Cursor...
start "" "D:\ProgramFiles\cursor\Cursor.exe"
echo Done. Check bottom-right HUD is: keepalive ON 2026-10-22g
pause