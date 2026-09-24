# Cryptos — Sunucu Kurulumu

| | |
|---|---|
| Klasör | `C:\UBS\Cryptos` |
| Yayın adresi | `http://78.188.115.58:3000` (22.09.2026 itibarıyla; eskisi `185.162.144.25`) |
| Sunucunun yerel IP'leri | `192.168.1.104`, `192.168.1.110` (DHCP), modem `192.168.1.1` |

Sunucu modem arkasında. Dışarıdan erişim, modemdeki **TCP 3000 → sunucunun yerel IP'si** yönlendirmesiyle sağlanıyor.
Dış IP ve yerel IP şu an sabit değil, ikisi de değişebilir. Ayrıntı için aşağıdaki "Dışarıdan erişilemiyor" başlığına bakın.

## Ön koşul

- **Node.js 18 veya üstü** (LTS önerilir), "tüm kullanıcılar için" kurulmuş olmalı.
  Kontrol: komut isteminde `node -v`. Yoksa https://nodejs.org → LTS → Windows Installer (.msi).
  Sunucuda şu an v22.14.0 kurulu (`C:\Program Files\nodejs`).
- Sunucunun internete çıkışı olmalı (npm paketleri ve Binance API).

## Kurulum

1. Zip'i sunucuya kopyalayın ve **`C:\UBS\Cryptos`** klasörüne açın.
   `kur.bat` doğrudan `C:\UBS\Cryptos\kur.bat` yolunda olmalı, alt klasörde değil.
2. Zip internetten indirildiyse: zip'e sağ tık → Özellikler → **Engellemeyi kaldır**. Bunu açmadan önce yapın.
3. `kur.bat` → sağ tık → **Yönetici olarak çalıştır**.

   Referans saatini değiştirmek gibi parametre vermeniz gerekiyorsa, yönetici olarak açtığınız
   pencereden çalıştırın. **PowerShell, bulunduğu klasördeki komutu `.\` olmadan çalıştırmaz:**

   | Pencere | Komut |
   |---|---|
   | PowerShell | `cd C:\UBS\Cryptos` ve ardından `.\kur.bat -ReferansSaati 03:00` |
   | Komut İstemi (cmd) | `cd /d C:\UBS\Cryptos` ve ardından `kur.bat -ReferansSaati 03:00` |
4. Betik sırasıyla şunları yapar:
   - Port 3000'i tutan eski kurulumu (`C:\Inetpub\cryptos-main`) bulur ve **onay isteyerek** durdurur.
     Eski zamanlanmış görevleri ve başlangıç klasöründeki `start_cryptos.vbs`'yi de sorarak devre dışı bırakır.
   - Bağımlılıkları kurar (`npm ci`).
   - `.env` dosyasını rastgele anahtarlarla oluşturur.
   - **Yönetici kullanıcı adı ve şifresi sorar.** En az 8 karakter olmalı; uygulama internete açık olduğu için güçlü bir şifre seçin.
   - **Telegram bildirimi kurmak isteyip istemediğinizi sorar** (isteğe bağlı, aşağıya bakın).
   - Bugünün referans fiyatlarını çeker (1–2 dk, işlem gören ~490 coin). Sonda görünen "Web sunucusu bildirimi hatası" normaldir.
   - Windows Güvenlik Duvarı'nda TCP 3000 için kural ekler. Sunucuda güvenlik duvarı şu an kapalı, kural yine de eklenir.
   - İki zamanlanmış görev oluşturur (SYSTEM hesabıyla):
     - **Cryptos Sunucu** — bilgisayar açılınca başlar, çökerse 5 sn içinde kendini yeniden başlatır.
     - **Cryptos Gunluk Fiyat** — her gece İstanbul saatiyle 03:05'te, o günün 03:00 fiyatlarını referans alır.
       (03:00 İstanbul = 00:00 UTC, yani Binance'in günlük mum açılışı.)
   - Sunucuyu başlatır ve kontrol eder.
   - Ekranda görünen her şeyi `logs\kurulum.log` dosyasına da yazar.
5. Tarayıcıdan `http://78.188.115.58:3000` adresini açın.
   Açılmıyorsa aşağıdaki "Dışarıdan erişilemiyor" başlığına bakın.

## Telegram bildirimleri

Bir coin şu koşulların **hepsini** aynı anda sağladığında Telegram'a mesaj gelir:

| Koşul | Varsayılan | `.env` anahtarı |
|---|---|---|
| BTC'den en az bu kadar puan fazla yükselmiş | 10 puan | `ALERT_MIN_EXCESS` |
| 24 saatlik hacmi en az | 5 milyon USDT | `ALERT_MIN_VOLUME` |
| Tepesinden en fazla bu kadar uzakta | %3 | `ALERT_MAX_FROM_PEAK` |
| Son 15 dakikada en az bu kadar yükselmiş | %1 | `ALERT_MIN_MOM15` |
| Aynı coin tekrar bildirilmeden önce beklenen süre | 60 dk | `ALERT_COOLDOWN_MIN` |

Kurulum (kurulumda atlandıysa):

1. Telegram'da **@BotFather** ile konuşun, `/newbot` yazın, bota bir ad verin. Size bir **token** verecek.
2. `C:\UBS\Cryptos` klasöründe komut isteminde: `npm run telegram`
3. Token'ı yapıştırın. Bu konsolda Ctrl+V çoğu zaman çalışmaz, **pencereye sağ tıklayın**.
   Token ekranda görünür; 3 deneme hakkı vardır. Betik isteyince oluşturduğunuz botu Telegram'da açıp `/start` yazın.
   Gruba göndermek için botu gruba ekleyip grupta bir mesaj yazın.
4. Deneme mesajı gelirse ayarlar kaydedilmiştir. `yeniden_baslat.bat` çalıştırın.

Eşikleri değiştirmek için `.env` dosyasını düzenleyip `yeniden_baslat.bat` çalıştırın.
Mevcut ayarlarla yalnızca deneme mesajı göndermek için: `npm run telegram -- --test`

Sunucu yeni başladığında "son 15 dakika" verisi 10 dakika boyunca birikir; bu sürede bildirim gelmez.

## Ekranı okuma

- **Çubuk:** Referans anından (başlıktaki saat) bu yana değişim.
  - Yeşil: yükselişte
  - Turuncu: zayıflıyor. Tepesinden %5'ten fazla düşmüş, kazancının %40'ından fazlasını geri vermiş ya da son 15 dakikada %1'den fazla gerilemiş.
  - Kırmızı: referansın altında
- **Arkadaki gri çubuk:** Referanstan bu yana görülen en yüksek seviye. Gri ile renkli çubuk arasındaki fark, geri verilen kazançtır.
- **Mavi kesik çizgi:** BTC'nin aynı dönemdeki değişimi. Çizginin altında kalan coin, piyasadan geride kalmıştır.
- **Üstteki durum göstergesi:** Yeşil "Canlı" normal durumdur. Sarı "Yedek bağlantı" durumunda Binance akışı kesilmiştir, veri 10 sn'de bir REST ile gelir. Kırmızı gösterge, **grafiğin güncel olmadığı** anlamına gelir.
- **En az 24s hacim:** Düşük hacimli coinleri gizler. Bu coinlerde küçük bir para fiyatı oynatabilir.
- Bilgisayarda çubuğun üzerine fareyle gelince ayrıntılar (tepe, hacim, son 15 dk) görünür.
  Tablet ve telefonda bu kutu çıkmaz, yalnızca çubuklar görünür.
- **"Güncel Fiyatları Kullan"** referansı şu ana çeker, **tüm kullanıcılar için**. Gece 03:05'te referans kendiliğinden o günün 03:00'ına döner.
- Çubukların üzerine gelince ayrıntılar görünür (bilgisayarda). Tıklama ile Binance'e gitme özelliği kaldırıldı.

## Ekrandaki alarmlar

Grafiğin altındaki **Alarmlar** panelinden kurulur. Tetiklenince ekranın sağ üst köşesinde
uyarı çıkar ve bip sesi duyulur.

- **Herhangi bir coin %X ve üzeri yükselirse:** Tek tek coin seçmeden, eşiği geçen her coin için uyarır.
- **Coin alarmı:** Belirli bir coin için "yükselirse / düşerse %X" alarmı eklenir. Alarm kurulan coin
  ilk 50'de olmasa da takip edilir. Eklenen alarmlar panelde listelenir, `×` ile silinir.
- Aynı alarm 10 dakika içinde tekrar çalmaz. Değer eşiğin altına inip tekrar geçerse yeniden çalar.
- **Sesli uyarı** kapatılabilir. "Sesi dene" düğmesi sesi kontrol eder.
  Tarayıcılar sese ancak sayfaya bir kez dokunduktan sonra izin verir; bu yüzden sayfayı açtıktan
  sonra bir yere dokunmak yeterlidir.
- Alarmlar **tarayıcıda saklanır**: her cihaz (tablet, bilgisayar) kendi alarmlarını tutar ve
  uyarı için o cihazda sayfanın açık olması gerekir. Sayfa kapalıyken de haber almak için
  Telegram bildirimini kullanın.

## Günlük işler

Hepsi `C:\UBS\Cryptos` içinde. `durdur` ve `yeniden_baslat` için yönetici olarak çalıştırın.

**PowerShell kullanıyorsanız komutun başına `.\` ekleyin** (`.\yeniden_baslat.bat` gibi);
Komut İstemi'nde (cmd) gerekmez. Çift tıklayarak da çalıştırılabilirler.

| İş | Komut |
|---|---|
| Yeniden başlat | `.\yeniden_baslat.bat` |
| Durdur | `.\durdur.bat` |
| Fiyatları şimdi güncelle | `.\guncelle.bat` |
| Belirli an için güncelle | `.\guncelle.bat 2026-09-21 14:30` |
| Referans saatini değiştir | `.\kur.bat -ReferansSaati 03:00` |
| Kullanıcı ekle / şifre değiştir | `npm run kullanici <kullanici_adi>` |
| Telegram kur / deneme mesajı | `npm run telegram` / `npm run telegram -- --test` |
| Sunucu logu | `logs\server.log` |
| Fiyat güncelleme logu | `logs\updater.log` |
| Kurulum logu | `logs\kurulum.log` |

Kullanıcı ekledikten ya da şifre değiştirdikten sonra yeniden başlatmaya gerek yok.

### Görev Zamanlayıcı'dan yönetim

`taskschd.msc` → Görev Zamanlayıcı Kitaplığı → **Cryptos Sunucu** / **Cryptos Gunluk Fiyat**.

| İş | Görev Zamanlayıcı'da |
|---|---|
| Sunucuyu başlat | Cryptos Sunucu → **Çalıştır** |
| Sunucuyu durdur | Cryptos Sunucu → **Sonlandır** (node da ~2 sn içinde kapanır) |
| Yeniden başlat | **Sonlandır**, birkaç saniye bekle, **Çalıştır** |
| Fiyatları şimdi güncelle | Cryptos Gunluk Fiyat → **Çalıştır** |
| Çalışıyor mu? | Durum sütunu "Çalışıyor"; ayrıntı `logs\server.log` |

Sunucu çökerse görev durmaz; `baslat.bat` 5 sn içinde yeniden başlatır.
Görevleri silmeyin ya da elle değiştirmeyin; `kur.bat` her çalıştırmada onları yeniden oluşturur.

## Güncelleme (sonraki sürümler)

Yeni zip'i aynı klasöre açıp üzerine yazın, ardından `kur.bat`'ı yine yönetici olarak çalıştırın.
Gizli dosyalar ve veritabanı pakette yoktur; sunucudakiler olduğu gibi kalır.

### Klasör düzeni

```
C:\UBS\Cryptos\
├─ src\        uygulama kodu (paketle gelir, üzerine yazılır)
├─ secrets\    .env (anahtarlar) ve users.json  — YEDEKLEYİN
├─ data\       crypto.db (referans fiyatlar)    — YEDEKLEYİN
├─ logs\       server.log, updater.log, kurulum.log
├─ deploy\     örnek ayar dosyaları
└─ kur.bat, baslat.bat, guncelle.bat, durdur.bat, yeniden_baslat.bat
```

`secrets\` ve `data\` klasörlerinin yedeğini alın; kurulum paketinde bunlar yoktur.

**2026-09-25 öncesi sürümden geçiş:** Eskiden her şey klasörün kökünde duruyordu.
`kur.bat` bunu kendisi düzeltir: `.env`, `users.json` ve `crypto.db` dosyalarını yeni
yerlerine taşır, kökte kalan eski kod dosyalarını siler, `.env` içindeki `DB_PATH`
değerini günceller. Elle bir şey yapmanız gerekmez.

**Klasörü önceden silmeyin ya da boşaltmayın.** `baslat.bat`, `guncelle.bat`, `durdur.bat`, `yeniden_baslat.bat` pakette yoktur.
Bu dosyaları `kur.bat` üretir. Silinirlerse görevler "son sonuç: 1" ile hemen biter ve site açılmaz.
Böyle olursa `kur.bat`'ı tekrar çalıştırmak yeterlidir.

## Sorun giderme

### Kurulum yarıda kaldı

Kırmızı **[HATA]** satırı ve `logs\kurulum.log` dosyası sorunun yerini gösterir.
Sorun çözüldükten sonra `kur.bat`'ı tekrar çalıştırın. Betik tekrar çalıştırılabilir, mevcut ayarları ezmez.

### Site açılmıyor

Önce sunucunun kendi içinde deneyin: tarayıcıdan `http://localhost:3000`.

- **Yerelde de açılmıyorsa:** Görev Zamanlayıcı'da **Cryptos Sunucu** "Çalışıyor" mu, bakın.
  Ayrıca `logs\server.log` dosyasının son satırlarını kontrol edin. Gerekirse `kur.bat`'ı tekrar çalıştırın.
- **Yerelde açılıp dışarıdan açılmıyorsa:** sorun sunucunun dışında, bir sonraki başlığa bakın.

### Dışarıdan erişilemiyor

Tarayıcı "yanıt vermesi çok uzun sürdü" (ERR_CONNECTION_TIMED_OUT) diyorsa istek sunucuya hiç ulaşmıyordur.

1. **Dış IP değişmiş olabilir.** 22.09.2026'da değişti: adres `185.162.144.25` iken `78.188.115.58` oldu.
   Sunucuda güncel dış IP'yi öğrenin:

   ```
   node -e "require('https').get('https://api.ipify.org',r=>r.on('data',d=>console.log(''+d)))"
   ```

   (Bu sunucuda `Invoke-RestMethod` HTTPS için TLS hatası verir, bu yüzden node kullanılıyor.)
2. **Yerel IP değişmiş olabilir.** Modemdeki (`192.168.1.1`) TCP 3000 yönlendirmesi, sunucunun şu anki
   yerel IP'lerinden birini göstermeli. Güncel yerel IP'leri görmek için komut isteminde `ipconfig` yazın.
3. Windows Güvenlik Duvarı bu sunucuda kapalı, yani bağlantıyı Windows engellemez.

**Kalıcı çözüm:**
- Modemde sunucuya **DHCP rezervasyonu** (sabit yerel IP) tanımlayın.
- Dış adres için sağlayıcıdan **sabit IP** alın ya da modemin **DDNS** özelliğini kullanın (No-IP gibi).
  DDNS kullanırsanız IP değişse de adres aynı kalır.

## Bilinen sınırlamalar

- Dış IP sabit değil. Değişince yayın adresi de değişir, yukarıdaki "Dışarıdan erişilemiyor" başlığına bakın.

- Bağlantı **düz HTTP**. Giriş şifresi ağda şifrelenmeden gider.
  Kalıcı çözüm: IIS (ARR + URL Rewrite) ya da benzeri bir ters vekil ile HTTPS.
- Giriş denemelerinde hız sınırı yok. Güçlü şifre kullanın.
- Oturumlar bellekte tutulur; sunucu yeniden başlayınca herkesin tekrar giriş yapması gerekir.
