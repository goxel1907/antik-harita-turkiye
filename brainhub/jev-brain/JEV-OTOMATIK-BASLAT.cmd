@echo off
rem JEV-Brain otomatik baslatma (R2544.101): yalniz TEST modunda 9Router + cekirdek + Office; CANLI ise baslatmaz, uyari verir
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0JEV-OTOMATIK-BASLAT.ps1"
