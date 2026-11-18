@echo off
title Autonomous Job Applying Agent
echo ======================================================
echo       Launching Autonomous Job Applying Agent
echo ======================================================
echo.
cd /d "%~dp0"
echo Starting local Web Dashboard on http://localhost:3000 ...
start http://localhost:3000
node index.js --dashboard
pause
