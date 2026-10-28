@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-ias20191-write-gateway.ps1"
endlocal
