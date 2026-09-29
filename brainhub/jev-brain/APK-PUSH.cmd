@echo off
rem APK-PUSH (C:\JEV-Brain) - APK kaynagini GitHuba gonderir, Codemagic yeni build baslatir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0APK-PUSH.ps1"
pause
