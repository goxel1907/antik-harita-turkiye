@echo off
rem Isolated Windows tests only. Does not stop, deploy, arm or contact the live bot.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-WindowsAcceptance.ps1" %*
set "acceptance_result=%errorlevel%"
echo.
pause
exit /b %acceptance_result%
