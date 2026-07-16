@echo off
rem AI作業場 起動用(ダブルクリックで起動)
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo AI作業場を起動しています...
call npm start
if errorlevel 1 pause
