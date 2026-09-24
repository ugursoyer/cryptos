<#
  Cryptos kurulum / guncelleme betigi
  -----------------------------------
  Kullanim: kur.bat dosyasina sag tiklayip "Yonetici olarak calistir".

  Yaptiklari:
    1. Node.js ve npm kontrolu
    2. Portu tutan eski kurulumu tespit edip (onay alarak) durdurma
    3. Bagimliliklari kurma (npm ci)
    4. .env dosyasini uretme (yoksa) - rastgele SESSION_SECRET ve INTERNAL_TOKEN
    5. Yonetici kullanicisi olusturma (users.json yoksa)
    6. Bugunun referans fiyatlarini cekme
    7. Guvenlik duvari kurali
    8. Zamanlanmis gorevler: acilista sunucu + her gece fiyat guncelleme
    9. Sunucuyu baslatip saglik kontrolu

  Tekrar calistirilabilir: .env, users.json ve crypto.db korunur.
  Not: Dosya ASCII tutuldu; Windows PowerShell 5.1 BOM'suz UTF-8'deki Turkce
  karakterleri bozuyor.
  Not: Tum desen eslestirmeleri buyuk/kucuk harf DUYARLI (-cmatch). Duyarsiz
  -match, Turkce Windows'ta 'I' harfini 'i' ile eslestirmiyor ('I' -> 'ı');
  bu yuzden ornegin SESSION_SECRET, INTERNAL_TOKEN okunamiyordu.
#>
param(
  [int]$Port = 0,
  # Referans ani (HH:MM). Yeni kurulumda .env'e yazilir.
  # Mevcut kurulumda SADECE bu parametre acikca verilirse degistirilir:
  #   kur.bat -ReferansSaati 03:00
  [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')]
  [string]$ReferansSaati = '03:00',
  # Guvenlik duvari, zamanlanmis gorev ve eski kurulum adimlarini atlar (test icin)
  [switch]$SkipSystem
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $AppDir

$TaskServer  = 'Cryptos Sunucu'
$TaskUpdater = 'Cryptos Gunluk Fiyat'
$LogDir      = Join-Path $AppDir 'logs'
$SecretsDir  = Join-Path $AppDir 'secrets'
$DataDir     = Join-Path $AppDir 'data'
$SrcDir      = Join-Path $AppDir 'src'
$EnvPath     = Join-Path $SecretsDir '.env'
$UsersPath   = Join-Path $SecretsDir 'users.json'
$DbPath      = Join-Path $DataDir 'crypto.db'
$Utf8NoBom   = New-Object System.Text.UTF8Encoding $false

# Node giris noktalari (src/ altinda)
$SunucuJs    = 'src\server.js'
$FiyatJs     = 'src\price_updater.js'
$HashJs      = 'src\scripts\hash_users.js'
$KullaniciJs = 'src\scripts\kullanici_ekle.js'
$TelegramJs  = 'src\scripts\telegram_ayarla.js'

# Kurulum ciktisi logs\kurulum.log'a da yazilir (yarida kalirsa teshis icin)
New-Item -ItemType Directory -Force $LogDir | Out-Null
try { Start-Transcript -Path (Join-Path $LogDir 'kurulum.log') -Append | Out-Null } catch {}

function Adim($m)  { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
function Tamam($m) { Write-Host "    [OK] $m" -ForegroundColor Green }
function Uyari($m) { Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Bilgi($m) { Write-Host "         $m" }
function Dur($m)   { Write-Host ''; Write-Host "[HATA] $m" -ForegroundColor Red; exit 1 }

function Sor($soru) {
  $c = Read-Host "    $soru (E/H)"
  return ($c -cmatch '^[EeYy]')
}

function RastgeleHex([int]$bayt) {
  $b = New-Object byte[] $bayt
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}

function EnvOku {
  $h = @{}
  if (Test-Path $EnvPath) {
    foreach ($satir in [System.IO.File]::ReadAllLines($EnvPath)) {
      if ($satir -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $h[$matches[1]] = $matches[2] }
    }
  }
  return $h
}

# Yerel program calistirir, ciktiyi ekrana basar, cikis kodunu dondurur.
# PS 5.1'de stderr'e yazilan uyarilar (npm, node) 'Stop' modunda betigi
# durdurabildigi icin cagri suresince 'Continue' kullanilir.
#
# Node UTF-8 yazar; '&' ile yakalanan cikti konsol kod sayfasiyla (857) cozulup
# Turkce karakterler bozulur. [Console]::OutputEncoding'i UTF-8 yapmak cozum
# DEGIL: Windows 10 oncesinde (Server 2012 R2) konsol 65001'deyken Turkce
# karakter yazmak Write-Host'u "0x1F aygit calismiyor" hatasiyla dusuruyor.
# Bu yuzden node ciktisi Process ile UTF-8 olarak okunur, konsola dokunulmaz.
function Calistir([string]$Exe, [string[]]$Arglar) {
  if ($Exe -eq $NodeExe) { return (NodeCalistir $Arglar) }
  $eski = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Exe @Arglar 2>&1 | ForEach-Object { Write-Host "         $_" }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $eski
  }
}

function NodeCalistir([string[]]$Arglar) {
  # stderr, cmd icinde stdout'a katilir: tek akis, okurken kilitlenme riski yok
  $argMetni = ($Arglar | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /s /c `"`"$NodeExe`" $argMetni 2>&1`""
  $psi.WorkingDirectory = $AppDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.StandardOutputEncoding = $Utf8NoBom
  $p = [System.Diagnostics.Process]::Start($psi)
  while ($null -ne ($satir = $p.StandardOutput.ReadLine())) {
    try { Write-Host "         $satir" } catch {}
  }
  $p.WaitForExit()
  return $p.ExitCode
}

function PortuDinleyen([int]$p) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.OwningProcess }
  return $null
}

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host '  Cryptos kurulumu' -ForegroundColor Cyan
Write-Host "  Klasor: $AppDir" -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan

# --- 0. Yonetici kontrolu ---------------------------------------------------
if (-not $SkipSystem) {
  $kimlik = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $kimlik.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Dur 'Yonetici yetkisi gerekiyor. kur.bat dosyasina sag tiklayip "Yonetici olarak calistir" secin.'
  }
}

# --- 1. Node.js -------------------------------------------------------------
Adim 'Node.js kontrol ediliyor'
# PATH'te birden fazla node.exe olabilir (eski kurulumlar); Get-Command o zaman dizi
# dondurur ve '&' calistiramaz. Ilki alinir, digerleri bilgi olarak gosterilir.
$nodeCmdler = @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue)
if ($nodeCmdler.Count -eq 0) { Dur 'Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu (tum kullanicilar icin) kurup tekrar deneyin.' }
$NodeExe = [string]$nodeCmdler[0].Path
if (-not $NodeExe -or -not (Test-Path $NodeExe)) { Dur "node.exe yolu cozulemedi: '$NodeExe'" }
if ($nodeCmdler.Count -gt 1) {
  Uyari "PATH'te birden fazla node.exe var, ilki kullanilacak:"
  $nodeCmdler | ForEach-Object { Bilgi $_.Path }
}
$nodeSurum = (& $NodeExe -v).Trim()
$ana = [int]($nodeSurum.TrimStart('v').Split('.')[0])
if ($ana -lt 18) { Dur "Node.js $nodeSurum cok eski; en az v18 gerekli." }
# Once secilen node.exe'nin yanindaki npm.cmd (surumler karismasin), yoksa PATH'teki ilki
$NpmExe = Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd'
if (-not (Test-Path $NpmExe)) {
  $NpmExe = [string](@(Get-Command npm.cmd -CommandType Application -All -ErrorAction SilentlyContinue) | Select-Object -First 1).Path
}
if (-not $NpmExe) { Dur 'npm bulunamadi. Node.js kurulumunu kontrol edin.' }
Tamam "Node.js $nodeSurum ($NodeExe)"
$nodeYolu = $NodeExe.ToLowerInvariant()
if ($nodeYolu.StartsWith($env:USERPROFILE.ToLowerInvariant()) -or $nodeYolu.Contains('\nvm')) {
  Uyari 'Node.js kullanici profiline kurulmus gorunuyor. Zamanlanmis gorev SYSTEM hesabiyla calisir;'
  Uyari 'sorun olursa Node.js''i "tum kullanicilar icin" yeniden kurun.'
}

# --- 1b. Klasor duzeni ve eski kurulumdan tasima ----------------------------
# 2026-09 oncesi surumde her sey kok dizindeydi. Yeni duzen:
#   src\ (kod)  secrets\ (.env, users.json)  data\ (crypto.db)  logs\
Adim 'Klasor duzeni'
New-Item -ItemType Directory -Force $SecretsDir | Out-Null
New-Item -ItemType Directory -Force $DataDir | Out-Null

if (-not (Test-Path (Join-Path $AppDir $SunucuJs))) {
  Dur "src\server.js bulunamadi. Zip'i bu klasore actiginizdan emin olun: $AppDir"
}

# Gizli dosyalar ve veritabani yeni yerine tasinir (icerikleri korunur)
$tasinacak = @(
  @{ Eski = (Join-Path $AppDir '.env');        Yeni = $EnvPath;   Ad = '.env' },
  @{ Eski = (Join-Path $AppDir 'users.json');  Yeni = $UsersPath; Ad = 'users.json' },
  @{ Eski = (Join-Path $AppDir 'crypto.db');   Yeni = $DbPath;    Ad = 'crypto.db' }
)
$tasindi = $false
foreach ($t in $tasinacak) {
  if (-not (Test-Path $t.Eski)) { continue }
  if (Test-Path $t.Yeni) {
    Move-Item $t.Eski "$($t.Eski).eski" -Force
    Uyari "$($t.Ad) her iki yerde de vardi; kokteki kopya '.eski' olarak birakildi"
  } else {
    Move-Item $t.Eski $t.Yeni
    Tamam "$($t.Ad) tasindi -> $($t.Yeni)"
    $tasindi = $true
  }
}
# SQLite yan dosyalari da tasinmali, yoksa veritabani bozuk gorunur
foreach ($ek in '-wal', '-shm') {
  $kaynak = (Join-Path $AppDir "crypto.db$ek")
  if (Test-Path $kaynak) { Move-Item $kaynak "$DbPath$ek" -Force }
}

# Eski surumun kokte biraktigi kod dosyalari (artik src\ altindalar)
$eskiKod = @('server.js', 'price_updater.js', 'piyasa.js', 'bildirim.js', 'hash_users.js',
             'kullanici_ekle.js', 'telegram_ayarla.js', '.env.example', 'users.example.json',
             'start_node.bat', 'start_cryptos.vbs', 'update_prices.bat')
$silinen = 0
foreach ($d in $eskiKod) {
  $yol = Join-Path $AppDir $d
  if (Test-Path $yol) { Remove-Item $yol -Force; $silinen++ }
}
foreach ($d in 'public', 'views', 'test') {
  $yol = Join-Path $AppDir $d
  if ((Test-Path $yol) -and (Test-Path (Join-Path $SrcDir $d))) { Remove-Item $yol -Recurse -Force; $silinen++ }
  elseif ((Test-Path $yol) -and ($d -eq 'test')) { Remove-Item $yol -Recurse -Force; $silinen++ }
}
if ($silinen -gt 0) { Tamam "$silinen eski dosya/klasor kaldirildi (kodlar artik src\ altinda)" }

# Kokteki eski loglar
foreach ($log in 'price_updater.log', 'price_updater_error.log') {
  $yol = Join-Path $AppDir $log
  if (Test-Path $yol) { Move-Item $yol (Join-Path $LogDir $log) -Force }
}
if (-not $tasindi -and $silinen -eq 0) { Tamam 'Duzen guncel' }

# --- 2. .env (port bilgisi icin once okunur) --------------------------------
$envDegerleri = EnvOku

# -Port verildi ama .env baska bir port soyluyorsa: sunucu .env'deki portu dinler
if ($PSBoundParameters.ContainsKey('Port') -and $envDegerleri['PORT'] -and [int]$envDegerleri['PORT'] -ne $Port) {
  Uyari "Parametre -Port $Port, ancak .env'de PORT=$($envDegerleri['PORT']) yaziyor."
  Uyari "Sunucu .env'deki portu dinler. Degistirmek icin .env dosyasini duzenleyin."
}

# Eski .env'de DB_PATH koke goreydi (crypto.db); veritabani artik data\ altinda
if ($envDegerleri['DB_PATH'] -and $envDegerleri['DB_PATH'] -cmatch '^\.?[\\/]?crypto\.db$') {
  $metin = [System.IO.File]::ReadAllText($EnvPath)
  $metin = [regex]::Replace($metin, '(?m)^DB_PATH=.*$', 'DB_PATH=data/crypto.db')
  [System.IO.File]::WriteAllText($EnvPath, $metin, $Utf8NoBom)
  $envDegerleri = EnvOku
  Tamam 'DB_PATH -> data/crypto.db olarak guncellendi'
}
if ($Port -eq 0) {
  if ($envDegerleri['PORT']) { $Port = [int]$envDegerleri['PORT'] } else { $Port = 3000 }
}

# --- 3. Calisan kurulumlar --------------------------------------------------
Adim "Port $Port ve eski kurulumlar kontrol ediliyor"

if (-not $SkipSystem) {
  # Bu kurulumun kendi gorevi calisiyorsa (guncelleme senaryosu) durdur
  $kendiGorev = Get-ScheduledTask -TaskName $TaskServer -ErrorAction SilentlyContinue
  if ($kendiGorev -and $kendiGorev.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $TaskServer
    Tamam "Calisan '$TaskServer' gorevi durduruldu"
    Start-Sleep -Seconds 2
  }

  # Baska bir yere isaret eden eski Cryptos gorevleri
  $eskiGorevler = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.TaskName -ne $TaskServer -and $_.TaskName -ne $TaskUpdater -and
    (($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join ' ').ToLowerInvariant() -cmatch 'cryptos|update_prices|price_updater'
  }
  foreach ($g in $eskiGorevler) {
    $eylem = ($g.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join '; '
    Uyari "Eski gorev bulundu: '$($g.TaskPath)$($g.TaskName)' -> $eylem"
    if ($g.State -ne 'Disabled' -and (Sor 'Bu gorev devre disi birakilsin mi?')) {
      Disable-ScheduledTask -TaskName $g.TaskName -TaskPath $g.TaskPath | Out-Null
      Tamam 'Devre disi birakildi'
    }
  }

  # Baslangic klasorundeki eski baslaticilar (start_cryptos.vbs vb.)
  $baslangicKlasorleri = @(
    [Environment]::GetFolderPath('CommonStartup'),
    [Environment]::GetFolderPath('Startup')
  )
  foreach ($k in $baslangicKlasorleri) {
    if (-not (Test-Path $k)) { continue }
    Get-ChildItem $k -File -ErrorAction SilentlyContinue | Where-Object { $_.Name.ToLowerInvariant() -cmatch 'crypto|start_node' } | ForEach-Object {
      Uyari "Baslangic klasorunde eski baslatici: $($_.FullName)"
      if (Sor 'Etkisiz hale getirilsin mi? (.devredisi uzantisi eklenir)') {
        Rename-Item $_.FullName ($_.Name + '.devredisi')
        Tamam 'Etkisiz hale getirildi'
      }
    }
  }
}

$dinleyen = PortuDinleyen $Port
if ($dinleyen) {
  $islem = Get-CimInstance Win32_Process -Filter "ProcessId=$dinleyen" -ErrorAction SilentlyContinue
  Uyari "Port $Port kullaniliyor: PID $dinleyen - $($islem.CommandLine)"
  if (Sor 'Bu islem durdurulsun mu? (Hayir derseniz kurulum durur)') {
    Stop-Process -Id $dinleyen -Force
    Start-Sleep -Seconds 2
    if (PortuDinleyen $Port) { Dur "Port $Port hala kullaniliyor." }
    Tamam 'Durduruldu'
  } else {
    Dur "Port $Port bos degil."
  }
} else {
  Tamam "Port $Port bos"
}

# --- 4. Bagimliliklar -------------------------------------------------------
Adim 'Bagimliliklar kuruluyor (npm ci) - internet gerekir, birkac dakika surebilir'
if ((Calistir $NpmExe @('ci', '--omit=dev', '--no-audit', '--no-fund')) -ne 0) { Dur 'npm ci basarisiz oldu. Yukaridaki hata mesajina bakin.' }
if ((Calistir $NodeExe @('-e', "require('sqlite3'); require('bcrypt'); require('express'); require('ws')")) -ne 0) { Dur 'Moduller yuklenemedi (sqlite3/bcrypt).' }
Tamam 'Bagimliliklar kuruldu'

# --- 5. .env ----------------------------------------------------------------
Adim '.env dosyasi'
if (-not (Test-Path $EnvPath)) {
  $icerik = @"
# Sunucu Ayarlari
SERVER_URL=http://localhost:$Port
PORT=$Port

# Veritabani Ayarlari
DB_PATH=data/crypto.db

# Guvenlik Ayarlari (kurulumda rastgele uretildi)
SESSION_SECRET=$(RastgeleHex 32)
INTERNAL_TOKEN=$(RastgeleHex 32)

# API Ayarlari
BINANCE_API_URL=https://api.binance.com/api/v3

# Uygulama Ayarlari
# Referans ani. 03:00 Istanbul = 00:00 UTC (Binance gunluk mum acilisi)
UPDATE_TIME=$ReferansSaati
TIMEZONE=Europe/Istanbul
"@
  [System.IO.File]::WriteAllText($EnvPath, $icerik, $Utf8NoBom)
  Tamam '.env olusturuldu (rastgele anahtarlarla)'
} else {
  Tamam '.env mevcut, korunuyor'
  $metin = [System.IO.File]::ReadAllText($EnvPath)

  # Referans ani: mevcut ayar korunur, yalnizca parametre acikca verilirse degisir
  $mevcutSaat = $envDegerleri['UPDATE_TIME']
  if ($PSBoundParameters.ContainsKey('ReferansSaati')) {
    if ($mevcutSaat -cne $ReferansSaati) {
      if ($metin -cmatch '(?m)^UPDATE_TIME=.*$') {
        $metin = [regex]::Replace($metin, '(?m)^UPDATE_TIME=.*$', "UPDATE_TIME=$ReferansSaati")
      } else {
        $metin = $metin.TrimEnd() + "`r`n`r`n# Referans ani`r`nUPDATE_TIME=$ReferansSaati`r`n"
      }
      [System.IO.File]::WriteAllText($EnvPath, $metin, $Utf8NoBom)
      $saatDegisti = $true
      Tamam "Referans ani $(if ($mevcutSaat) { $mevcutSaat } else { '(yok)' }) -> $ReferansSaati olarak degistirildi"
    } else {
      Tamam "Referans ani zaten $ReferansSaati"
    }
  } elseif ($mevcutSaat) {
    Bilgi "Referans ani: $mevcutSaat (degistirmek icin: kur.bat -ReferansSaati 03:00)"
  }
  if (-not $envDegerleri['INTERNAL_TOKEN']) {
    $metin = $metin.TrimEnd() + "`r`n`r`n# price_updater -> sunucu tetikleme anahtari`r`nINTERNAL_TOKEN=$(RastgeleHex 32)`r`n"
    [System.IO.File]::WriteAllText($EnvPath, $metin, $Utf8NoBom)
    Tamam 'INTERNAL_TOKEN eklendi'
  }
  $gizli = $envDegerleri['SESSION_SECRET']
  if (-not $gizli -or $gizli -eq 'gizli-bir-cumle-olacak-buraya' -or $gizli.Length -lt 32) {
    Uyari 'SESSION_SECRET varsayilan/kisa. Yenisi uretiliyor (acik oturumlar kapanir).'
    $metin = [System.IO.File]::ReadAllText($EnvPath)
    if ($metin -cmatch '(?m)^SESSION_SECRET=.*$') {
      $metin = [regex]::Replace($metin, '(?m)^SESSION_SECRET=.*$', "SESSION_SECRET=$(RastgeleHex 32)")
    } else {
      $metin = $metin.TrimEnd() + "`r`nSESSION_SECRET=$(RastgeleHex 32)`r`n"
    }
    [System.IO.File]::WriteAllText($EnvPath, $metin, $Utf8NoBom)
  }
}
$envDegerleri = EnvOku

# --- 6. Kullanicilar --------------------------------------------------------
Adim 'Kullanicilar'
$kullaniciVar = $false
if (Test-Path $UsersPath) {
  try { $kullaniciVar = @((Get-Content $UsersPath -Raw | ConvertFrom-Json)).Count -gt 0 } catch { $kullaniciVar = $false }
}

if ($kullaniciVar) {
  if ((Calistir $NodeExe @($HashJs)) -ne 0) { Dur 'users.json islenemedi.' }
  Remove-Item "$UsersPath.bak" -ErrorAction SilentlyContinue
  Tamam 'users.json mevcut, sifreler hash''li'
} else {
  # CRYPTOS_ADMIN_USER / CRYPTOS_ADMIN_PASSWORD tanimliysa sorulmaz (otomatik test icin)
  $kadi = $env:CRYPTOS_ADMIN_USER
  if (-not $kadi) { $kadi = Read-Host '    Yonetici kullanici adi [admin]' }
  if (-not $kadi) { $kadi = 'admin' }

  $sifre = $env:CRYPTOS_ADMIN_PASSWORD
  while (-not $sifre) {
    $s1 = Read-Host '    Sifre (en az 8 karakter)' -AsSecureString
    $s2 = Read-Host '    Sifre (tekrar)' -AsSecureString
    $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
    $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
    if ($p1 -ne $p2)        { Uyari 'Sifreler eslesmiyor, tekrar deneyin.'; continue }
    if ($p1.Length -lt 8)   { Uyari 'Sifre en az 8 karakter olmali.'; continue }
    $sifre = $p1
  }

  $env:CRYPTOS_PASSWORD = $sifre
  try {
    if ((Calistir $NodeExe @($KullaniciJs, $kadi)) -ne 0) { Dur 'Kullanici olusturulamadi.' }
  } finally {
    Remove-Item Env:\CRYPTOS_PASSWORD -ErrorAction SilentlyContinue
    $sifre = $null; $p1 = $null; $p2 = $null
  }
  Tamam "'$kadi' olusturuldu"
}

# --- 6b. Telegram bildirimleri (istege bagli) -------------------------------
if (-not $SkipSystem -and -not $envDegerleri['TELEGRAM_CHAT_ID']) {
  Adim 'Telegram bildirimleri (istege bagli)'
  Bilgi 'Piyasadan ayrisan, hacimli ve hala yukselen coinler Telegram ile bildirilir.'
  Bilgi 'Once Telegram''da @BotFather ile bir bot olusturup token almaniz gerekir.'
  if (Sor 'Simdi kurulsun mu? (Sonra "node src\scripts\telegram_ayarla.js" ile de kurulabilir)') {
    # Etkilesimli calisir (token ve sohbet secimi sorar); cikti dogrudan ekrana gider
    $eski = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $env:CRYPTOS_KURULUM = '1'
    try {
      & $NodeExe $TelegramJs
      $kod = $LASTEXITCODE
    } finally {
      Remove-Item Env:\CRYPTOS_KURULUM -ErrorAction SilentlyContinue
      $ErrorActionPreference = $eski
    }
    if ($kod -ne 0) { Uyari 'Telegram kurulamadi; sonra "node src\scripts\telegram_ayarla.js" ile tekrar deneyin.' }
    else { Tamam 'Telegram bildirimleri ayarlandi' }
    $envDegerleri = EnvOku
  } else {
    Bilgi 'Atlandi.'
  }
}

# --- 7. Baslatma betikleri --------------------------------------------------
Adim 'Baslatma betikleri yaziliyor'
New-Item -ItemType Directory -Force $LogDir | Out-Null

# Not: 'timeout' komutu konsolsuz (zamanlanmis gorev) ortamda calismaz; bekleme icin ping kullaniliyor.
$baslat = @"
@echo off
rem Cryptos sunucusu. Kur.ps1 tarafindan uretildi.
rem Surec cokerse 5 saniye sonra yeniden baslatilir.
cd /d "%~dp0"
if not exist logs mkdir logs
rem Gorev sonlandirilinca node'un da kapanmasi icin (server.js ebeveyni izler)
set CRYPTOS_GOREV=1
:dongu
echo [%date% %time%] Sunucu baslatiliyor>> logs\server.log
"$NodeExe" $SunucuJs>> logs\server.log 2>&1
echo [%date% %time%] Sunucu durdu (kod %errorlevel%), 5 sn sonra yeniden baslatilacak>> logs\server.log
ping -n 6 127.0.0.1 > nul
goto dongu
"@

$guncelle = @"
@echo off
rem Referans fiyatlari gunceller. Kur.ps1 tarafindan uretildi.
rem Kullanim: guncelle.bat                   (bugun, UPDATE_TIME saatine gore)
rem           guncelle.bat 2026-09-21 14:30  (belirli tarih ve saat)
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] Fiyat guncelleme basladi %*>> logs\updater.log
"$NodeExe" $FiyatJs %*>> logs\updater.log 2>&1
echo [%date% %time%] Fiyat guncelleme bitti (kod %errorlevel%)>> logs\updater.log
"@

$durdur = @"
@echo off
rem Cryptos sunucusunu durdurur. Yonetici olarak calistirin.
schtasks /end /tn "$TaskServer" > nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":$Port .*LISTENING"') do taskkill /f /pid %%p
echo Durduruldu.
"@

$yenidenBaslat = @"
@echo off
rem Cryptos sunucusunu yeniden baslatir. Yonetici olarak calistirin.
call "%~dp0durdur.bat"
ping -n 3 127.0.0.1 > nul
schtasks /run /tn "$TaskServer"
echo Baslatildi: http://localhost:$Port
"@

[System.IO.File]::WriteAllText((Join-Path $AppDir 'baslat.bat'), $baslat, [System.Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $AppDir 'guncelle.bat'), $guncelle, [System.Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $AppDir 'durdur.bat'), $durdur, [System.Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $AppDir 'yeniden_baslat.bat'), $yenidenBaslat, [System.Text.Encoding]::ASCII)
Tamam 'baslat.bat, guncelle.bat, durdur.bat, yeniden_baslat.bat'

# --- 8. Referans fiyatlar ---------------------------------------------------
Adim 'Bugunun referans fiyatlari (yoksa aliniyor, 1-2 dakika)'
Bilgi 'Sonunda "Web sunucusu bildirimi hatasi" gorulmesi normaldir; sunucu henuz baslamadi.'
# Referans ani degistiyse bugunun referansi yeni saate gore yeniden alinir;
# aksi halde --eksikse ile, kullanicinin gun icinde sectigi referans korunur.
$updaterArgs = if ($saatDegisti) { @($FiyatJs, '--gelecegi-sil') } else { @($FiyatJs, '--eksikse') }
if ((Calistir $NodeExe $updaterArgs) -ne 0) { Uyari 'Fiyatlar alinamadi. Kurulum surecek; sonra guncelle.bat ile tekrar deneyin.' }
else { Tamam 'Referans fiyatlar kaydedildi' }

if (-not $SkipSystem) {
  # --- 9. Guvenlik duvari ---------------------------------------------------
  Adim 'Guvenlik duvari'
  $kuralAdi = "Cryptos TCP $Port"
  if (-not (Get-NetFirewallRule -DisplayName $kuralAdi -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $kuralAdi -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
    Tamam "Gelen baglanti kurali eklendi: $kuralAdi"
  } else {
    Tamam "Kural zaten var: $kuralAdi"
  }

  # --- 10. Zamanlanmis gorevler ---------------------------------------------
  Adim 'Zamanlanmis gorevler'
  $sistem = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

  # Sunucu: bilgisayar acilinca, sure siniri olmadan
  $eylem = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$AppDir\baslat.bat`"" -WorkingDirectory $AppDir
  $tetik = New-ScheduledTaskTrigger -AtStartup
  $ayar  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskServer -Action $eylem -Trigger $tetik -Principal $sistem -Settings $ayar -Description 'Cryptos web sunucusu' -Force | Out-Null
  Tamam "'$TaskServer' (acilista)"

  # Gunluk fiyat: UPDATE_TIME + 5 dk, uygulamanin saat diliminde. Sunucu saati farkliysa cevrilir.
  $uygTz = switch -CaseSensitive ($envDegerleri['TIMEZONE']) {
    'Europe/Istanbul' { 'Turkey Standard Time' }
    'UTC'             { 'UTC' }
    default           { Uyari "TIMEZONE '$($envDegerleri['TIMEZONE'])' taninmadi, Istanbul varsayildi."; 'Turkey Standard Time' }
  }
  $saat = if ($envDegerleri['UPDATE_TIME']) { $envDegerleri['UPDATE_TIME'] } else { $ReferansSaati }
  $hs = $saat.Split(':')
  $bugunUyg = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, [TimeZoneInfo]::FindSystemTimeZoneById($uygTz)).Date
  $hedefUyg = [DateTime]::SpecifyKind($bugunUyg.AddHours([int]$hs[0]).AddMinutes([int]$hs[1] + 5), [DateTimeKind]::Unspecified)
  $hedefYerel = [TimeZoneInfo]::ConvertTime($hedefUyg, [TimeZoneInfo]::FindSystemTimeZoneById($uygTz), [TimeZoneInfo]::Local)

  $eylem = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$AppDir\guncelle.bat`"" -WorkingDirectory $AppDir
  $tetik = New-ScheduledTaskTrigger -Daily -At $hedefYerel
  $ayar  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskUpdater -Action $eylem -Trigger $tetik -Principal $sistem -Settings $ayar -Description 'Cryptos gunluk referans fiyat guncellemesi' -Force | Out-Null
  Tamam ("'$TaskUpdater' her gun {0} sunucu saatiyle ({1} {2})" -f $hedefYerel.ToString('HH:mm'), $hedefUyg.ToString('HH:mm'), $envDegerleri['TIMEZONE'])

  # --- 11. Baslat -----------------------------------------------------------
  Adim 'Sunucu baslatiliyor'
  Start-ScheduledTask -TaskName $TaskServer
} else {
  Adim 'Sunucu baslatiliyor (test modu, zamanlanmis gorev olmadan)'
  Start-Process -FilePath 'cmd.exe' -ArgumentList "/c `"$AppDir\baslat.bat`"" -WorkingDirectory $AppDir -WindowStyle Hidden
}

# --- 12. Saglik kontrolu ----------------------------------------------------
$hazir = $false
for ($i = 0; $i -lt 40 -and -not $hazir; $i++) {
  Start-Sleep -Milliseconds 500
  if (PortuDinleyen $Port) { $hazir = $true }
}
if (-not $hazir) { Dur "Sunucu $Port portunda baslamadi. $LogDir\server.log dosyasina bakin." }

try {
  $r = Invoke-WebRequest "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 10
  Tamam "Giris sayfasi yanit veriyor (HTTP $([int]$r.StatusCode))"
} catch { Dur "Giris sayfasi yanit vermiyor: $($_.Exception.Message)" }

try {
  Invoke-WebRequest "http://localhost:$Port/api/livecoins" -UseBasicParsing -TimeoutSec 10 | Out-Null
  Uyari 'API oturumsuz erisime ACIK - beklenmiyordu!'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 401) { Tamam 'API oturumsuz erisime kapali (401)' }
}

$canli = $false
for ($i = 0; $i -lt 30 -and -not $canli; $i++) {
  Start-Sleep -Seconds 1
  # piyasa.js dakikada bir "Canli: ... kaynak=akis|rest" ozeti yazar; ilki ilk veriyle gelir
  if (Select-String -Path (Join-Path $LogDir 'server.log') -Pattern 'kaynak=(akis|rest)' -CaseSensitive -Quiet -ErrorAction SilentlyContinue) { $canli = $true }
}
if ($canli) { Tamam 'Binance canli verisi geliyor' }
else        { Uyari 'Binance''ten 30 sn icinde veri gelmedi. logs\server.log dosyasini kontrol edin.' }

Write-Host ''
Write-Host '============================================' -ForegroundColor Green
Write-Host '  Kurulum tamamlandi' -ForegroundColor Green
Write-Host "  Yerel adres : http://localhost:$Port" -ForegroundColor Green
Write-Host "  Dis adres   : http://<sunucu-ip>:$Port" -ForegroundColor Green
Write-Host "  Loglar      : $LogDir" -ForegroundColor Green
Write-Host '============================================' -ForegroundColor Green
if (-not $SkipSystem) {
  Write-Host ''
  Bilgi 'Disaridan erisilemiyorsa barindirma saglayicinizin guvenlik duvarinda'
  Bilgi "da TCP $Port portunun acik oldugunu kontrol edin."
}
