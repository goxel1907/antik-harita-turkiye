@echo off
rem JEV-Brain core + Office baslat (zaten calisiyorsa dokunmaz)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\manage.ps1" -Action Start -Root "C:\JEV-Brain\runtime"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\office-dashboard\START-OFFICE.ps1" -BrainRoot "C:\JEV-Brain\runtime" -BackupRoot "C:\JEV-Brain\BrainHubBackups"
pause
