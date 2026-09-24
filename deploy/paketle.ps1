<#
  Kurulum paketini uretir: dist\Cryptos_Kurulum_<tarih>.zip
  Zip, sunucuda dogrudan uygulama klasorune (C:\UBS\Cryptos) acilacak sekilde duzenlenir.

  Kullanim (repo kokunden):
    powershell -ExecutionPolicy Bypass -File deploy\paketle.ps1

  Icerik: src\ (kod, views, public), package.json, package-lock.json, README.md,
          kur.bat, kur.ps1, KURULUM.md, ornek ayar dosyalari

  Bilerek DAHIL EDILMEYENLER: secrets\ (.env, users.json), data\ (crypto.db),
  node_modules, logs, dist, arsiv
  (sunucudakiler korunur; bagimliliklar sunucuda npm ci ile kurulur)
#>
$ErrorActionPreference = 'Stop'
$Kok   = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Tarih = Get-Date -Format 'yyyy-MM-dd'
$Dist  = Join-Path $Kok 'dist'
$Gecici = Join-Path $Dist "paket_$Tarih"
$Zip   = Join-Path $Dist "Cryptos_Kurulum_$Tarih.zip"

$Dosyalar = @('package.json', 'package-lock.json', 'README.md')
$Klasorler = @('src')
$DeployDosyalari = @('kur.ps1', 'kur.bat', 'KURULUM.md', 'ornek.env', 'ornek-users.json')

if (Test-Path $Gecici) { Remove-Item $Gecici -Recurse -Force }
New-Item -ItemType Directory -Force $Gecici | Out-Null

foreach ($d in $Dosyalar)        { Copy-Item (Join-Path $Kok $d) $Gecici }
foreach ($k in $Klasorler)       { Copy-Item (Join-Path $Kok $k) $Gecici -Recurse }
# Ornek ayar dosyalari zip icinde deploy\ altinda kalsin, kok kalabalik olmasin
New-Item -ItemType Directory -Force (Join-Path $Gecici 'deploy') | Out-Null
foreach ($d in $DeployDosyalari) {
  $hedef = if ($d -eq 'kur.bat' -or $d -eq 'kur.ps1' -or $d -eq 'KURULUM.md') { $Gecici } else { Join-Path $Gecici 'deploy' }
  Copy-Item (Join-Path $Kok "deploy\$d") $hedef
}

if (Test-Path $Zip) { Remove-Item $Zip -Force }
# Compress-Archive (PS 5.1) zip icine ters egik cizgili yol yazar ve standart disidir;
# bu yuzden girdiler '/' ayraciyla dogrudan eklenir.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::Open($Zip, 'Create')
try {
  Get-ChildItem $Gecici -Recurse -File -Force | ForEach-Object {
    $goreli = $_.FullName.Substring($Gecici.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $_.FullName, $goreli, 'Optimal') | Out-Null
  }
} finally {
  $z.Dispose()
}

Remove-Item $Gecici -Recurse -Force
Write-Host "Paket hazir: $Zip ($([math]::Round((Get-Item $Zip).Length / 1KB)) KB)"
