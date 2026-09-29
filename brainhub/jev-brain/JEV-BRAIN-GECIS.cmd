@echo off
rem JEV-BRAIN-GECIS (C:\JEV-Brain) - sag tik > Yonetici olarak calistir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0JEV-BRAIN-GECIS.ps1" %*
echo.
echo Log: %~dp0logs
pause
