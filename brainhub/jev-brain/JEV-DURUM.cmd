@echo off
rem JEV-Brain saglik testi (core 8787)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\manage.ps1" -Action Test -Root "C:\JEV-Brain\runtime"
pause
