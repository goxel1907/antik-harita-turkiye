@echo off
rem JEV-Brain Office ekranini ac
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\office-dashboard\START-OFFICE.ps1" -BrainRoot "C:\JEV-Brain\runtime" -BackupRoot "C:\JEV-Brain\BrainHubBackups"
