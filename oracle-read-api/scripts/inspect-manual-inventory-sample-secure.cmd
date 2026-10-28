@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0inspect-manual-inventory-sample-secure.ps1" -DocumentNo 3
endlocal
