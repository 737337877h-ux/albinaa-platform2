@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0inspect-inventory-count-document-secure.ps1" -DocumentNo 3 -UserId 1
endlocal
