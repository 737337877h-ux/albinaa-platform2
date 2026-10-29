@echo off
title Install IAS20261 Unified Write Gateway
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-ias20261-unified-write-gateway.ps1" -Action Install
echo.
pause
