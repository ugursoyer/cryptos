@echo off
rem ============================================================================
rem KULLANIM BİLGİLERİ:
rem ----------------------------------------------------------------------------
rem 1. Parametresiz çalıştırma (güncel tarih ve saat kullanılır):
rem    update_prices.bat
rem    veya sadece çift tıklayarak çalıştırabilirsiniz.
rem 
rem 2. Belirli bir tarih için çalıştırma (güncel saat kullanılır):
rem    update_prices.bat 2025-03-17
rem 
rem 3. Belirli bir tarih ve saat için çalıştırma:
rem    update_prices.bat 2025-03-17 15:30
rem ============================================================================

cd /d %~dp0

rem Güncel tarih ve saati al (Türkiye formatında)
for /f "tokens=2 delims==" %%a in ('wmic os get LocalDateTime /value') do set dt=%%a
set YEAR=%dt:~0,4%
set MONTH=%dt:~4,2%
set DAY=%dt:~6,2%
set HOUR=%dt:~8,2%
set MINUTE=%dt:~10,2%

rem Tarih formatını YYYY-MM-DD olarak ayarla
set TODAY=%YEAR%-%MONTH%-%DAY%
rem Saat formatını HH:MM olarak ayarla
set NOW=%HOUR%:%MINUTE%

echo Güncel tarih: %TODAY%
echo Güncel saat: %NOW%

rem Tarih ve saat parametrelerini kontrol et
if "%1"=="" (
  rem Parametre yoksa, güncel tarih ve saat ile çalıştır
  echo Güncel tarih ve saat ile çalıştırılıyor...
  node price_updater.js %TODAY% %NOW%
) else (
  if "%2"=="" (
    rem Sadece tarih parametresi varsa
    echo Belirtilen tarih ve güncel saat ile çalıştırılıyor...
    node price_updater.js %1 %NOW%
  ) else (
    rem Hem tarih hem saat parametresi varsa
    echo Belirtilen tarih ve saat ile çalıştırılıyor...
    node price_updater.js %1 %2
  )
)

echo İşlem tamamlandı.
timeout /t 5 