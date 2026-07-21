@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install LTS from https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo First-time setup: running npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check the log above.
        pause
        exit /b 1
    )
)

echo Starting app...
call npm start
if errorlevel 1 pause
