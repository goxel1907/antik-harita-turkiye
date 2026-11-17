@echo off
chcp 65001 >nul
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node bulunamadi. Bu dosyayi JEV-Brain bilgisayarinda calistirin.
  pause
  exit /b 1
)
node.exe "%~dp0collect-diagnostics.cjs" --brain-root "C:\JEV-Brain"
echo.
echo Yazilan ZIP veya JEV-TESHIS.json dosyasini bu sohbete ekleyin.
pause
