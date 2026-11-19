@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-R194-Deploy.ps1" %*
set "jev_r194_exit=%errorlevel%"
echo.
if not "%jev_r194_exit%"=="0" echo Kurulum tam dogrulanmadi. Yazilan ZIP dosyasini bu sohbete ekleyin.
pause
exit /b %jev_r194_exit%
