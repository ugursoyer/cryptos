@echo off
rem Cryptos kurulumu - sag tiklayip "Yonetici olarak calistir" secin.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kur.ps1" %*
echo.
pause
