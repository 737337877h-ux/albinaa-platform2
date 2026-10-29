@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-inventory-audit-metadata-secure.ps1"
endlocal
