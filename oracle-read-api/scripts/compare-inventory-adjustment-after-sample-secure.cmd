@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0compare-inventory-adjustment-after-sample-secure.ps1"
endlocal
