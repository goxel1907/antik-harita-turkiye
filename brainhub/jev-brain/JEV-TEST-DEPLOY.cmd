@echo off
rem JEV-TEST-DEPLOY (C:\JEV-Brain) - yalniz TEST modunda: TEST guvenle durur, JEV-DEPLOY aynen calisir, TEST yeniden baslar.
rem Sag tik > Yonetici olarak calistir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0JEV-TEST-DEPLOY.ps1" %*
echo.
echo Log: %~dp0logs
pause
