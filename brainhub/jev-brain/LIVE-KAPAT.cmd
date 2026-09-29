@echo off
rem JEV-Brain LIVE KAPAT (acil durum). LIVE yetkisini kaldirir; acik pozisyonlara ve borsadaki stop/TP emirlerine dokunmaz.
set "MG=C:\BrainHub\manage.ps1"
set "RT=C:\BrainHub"
if exist "C:\JEV-Brain\runtime\manage.ps1" (
  set "MG=C:\JEV-Brain\runtime\manage.ps1"
  set "RT=C:\JEV-Brain\runtime"
)
echo Kok: %RT%
powershell -NoProfile -ExecutionPolicy Bypass -File "%MG%" -Action LiveDisarm -Root "%RT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%MG%" -Action LiveStatus -Root "%RT%"
timeout /t 8
