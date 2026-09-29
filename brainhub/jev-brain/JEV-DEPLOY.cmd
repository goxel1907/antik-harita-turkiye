@echo off
rem JEV-DEPLOY (C:\JEV-Brain) - sag tik > Yonetici olarak calistir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0JEV-DEPLOY.ps1" %*
echo.
echo Log: %~dp0logs
pause
