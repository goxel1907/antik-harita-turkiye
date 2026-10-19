@echo off
rem JEV-Brain "Office" masaustu kisayolu (R2544.58): Office ekranini acar; cekirdek (8787) kapaliysa arka planda baslatir.
rem Cekirdegin acilis testi birkac dakika surer; Office o sirada "PC baglanti bekleniyor" gosterir, sonra kendiliginden baglanir.
rem CANLI kendiliginden acilmaz; TEST, kapanmadan onceki gibi devam eder.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "if(-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)){ Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0runtime\manage.ps1','-Action','Start','-Root','%~dp0runtime' }"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\office-dashboard\START-OFFICE.ps1" -BrainRoot "%~dp0runtime" -BackupRoot "%~dp0BrainHubBackups"
