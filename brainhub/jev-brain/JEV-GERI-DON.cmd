@echo off
rem JEV-GERI-DON (C:\JEV-Brain) - sag tik > Yonetici olarak calistir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0JEV-GERI-DON.ps1" %*
echo.
echo Log: %~dp0logs
pause
