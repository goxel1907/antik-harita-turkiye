@echo off
rem Extract the delivery ZIP first, then double-click this file. No live deploy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-IsolatedWindowsAcceptance.ps1" %*
set "acceptance_result=%errorlevel%"
echo.
if not "%acceptance_result%"=="0" echo Acceptance did not pass. Read the error/evidence; no live installation was performed.
pause
exit /b %acceptance_result%
