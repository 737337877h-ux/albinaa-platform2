@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture-inventory-adjustment-baseline-secure.ps1"
endlocal
