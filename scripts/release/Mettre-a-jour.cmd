@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shop.ps1" %*
if errorlevel 1 pause
