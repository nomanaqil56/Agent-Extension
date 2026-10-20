@echo off
TITLE Antigravity Local Agent Engine
cd /d "%~dp0\..\local-engine"
echo ===================================================
echo   Starting Antigravity Local Agent Engine Daemon...
echo ===================================================
npm start
pause
