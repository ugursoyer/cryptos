# Cryptos — Kripto Para Takip Uygulaması

Binance'teki USDT çiftlerinin, günün referans anından (varsayılan İstanbul saatiyle 03:00 = 00:00 UTC) bu yana
değişimini canlı olarak gösteren web uygulaması. BTC'den ayrışarak yükselen, hacimli coinleri
Telegram ile bildirebilir.

Sunucu kurulumu ve günlük kullanım için: **[deploy/KURULUM.md](deploy/KURULUM.md)**

## Özellikler

- Canlı fiyatlar: Binance WebSocket akışı, akış kesilirse 10 sn'de bir REST ile yedek
- Günlük referans fiyat: her gece 03:05'te o günün 03:00 fiyatları alınır (Binance günlük mum açılışı), arayüzden "şu an"a çekilebilir
- Grafikte zirve seviyesi, BTC karşılaştırma çizgisi, zayıflama (turuncu) göstergesi, hacim filtresi
- Ekran alarmı: genel eşik ve coin bazlı alarm, sesli uyarı (ayarlar tarayıcıda saklanır)
- İsteğe bağlı Telegram bildirimi (eşikler `.env` üzerinden)
- Oturumlu giriş; şifreler bcrypt ile hash'li, kullanıcılar `secrets/users.json` dosyasında

## Teknik altyapı

- Node.js (18+) + Express, EJS şablonları
- Socket.IO (tarayıcıya canlı veri), `ws` (Binance akışı), Axios
- SQLite3 (`data/crypto.db`, günlük referans fiyatlar)
- express-session (bellekte oturum)

## Dizin yapısı

```
Cryptos/
├─ src/                    uygulama kodu
│  ├─ server.js            web sunucusu, giriş, API uçları, Socket.IO yayını
│  ├─ yollar.js            tüm dosya yollarının ve .env yüklemesinin tek adresi
│  ├─ piyasa.js            Binance canlı fiyat/hacim akışı, REST yedeği, bekçi
│  ├─ bildirim.js          Telegram bildirim kuralları
│  ├─ price_updater.js     referans fiyatları çekip veritabanına yazar
│  ├─ views/               EJS şablonları
│  ├─ public/              tarayıcıya giden dosyalar (js, css)
│  └─ scripts/             komut satırı araçları
│     ├─ kullanici_ekle.js   kullanıcı ekler / şifre değiştirir
│     ├─ hash_users.js       users.json'daki düz şifreleri hash'ler
│     └─ telegram_ayarla.js  Telegram bot ve sohbet kurulumu
├─ secrets/                GİZLİ: .env (anahtarlar), users.json — git dışında
├─ data/                   crypto.db (referans fiyatlar) — git dışında
├─ logs/                   sunucu, güncelleyici ve kurulum logları — git dışında
├─ deploy/                 kurulum betikleri, paketleyici, örnek ayar dosyaları
├─ arsiv/                  eski, kullanılmayan betikler
└─ package.json
```

Gizli bilgilerin ne olduğu ve nasıl değiştirileceği: [`secrets/README.md`](secrets/README.md)

API uçları: `/api/livecoins`, `/api/currentdate`, `/api/update-prices` (oturum gerekir),
`/api/reload-date` (oturum ya da `INTERNAL_TOKEN`).

## Geliştirme ortamında çalıştırma

```bash
npm install
cp deploy/ornek.env secrets/.env   # SESSION_SECRET ve INTERNAL_TOKEN'ı doldurun
npm run kullanici admin            # şifreyi sorar
npm run fiyat                      # referans fiyatları çeker
npm start                          # http://localhost:3000
```

| Komut | Görev |
|---|---|
| `npm start` | Sunucuyu başlatır |
| `npm run fiyat` | Referans fiyatları çeker (`npm run fiyat -- 2026-09-21 14:30` ile belirli an) |
| `npm run kullanici <ad>` | Kullanıcı ekler / şifre değiştirir |
| `npm run telegram` | Telegram bildirimini kurar |

## Sunucuya paket hazırlama

```powershell
powershell -ExecutionPolicy Bypass -File deploy\paketle.ps1
```

`dist\Cryptos_Kurulum_<tarih>.zip` üretilir. `secrets/`, `data/`, `node_modules` ve `logs`
pakete girmez. Sunucudakiler korunur, bağımlılıklar sunucuda `npm ci` ile kurulur.
Kurulum betiği eski düzendeki (her şeyin kökte olduğu) bir kurulumu yeni düzene kendisi taşır.

### Hedef sunucu hakkında notlar

Sunucu eski bir Windows sürümü (PowerShell 4, muhtemelen Server 2012 R2). `kur.ps1`'i değiştirirken:

- Yalnızca PowerShell 4'te çalışan özellikler kullanın. Örneğin `Get-Command(...).Source` yok, `.Path` kullanın.
- `[Console]::OutputEncoding`'i UTF-8 yapmayın. Konsol 65001'deyken Türkçe karakter yazmak
  Write-Host'u çökertiyor. Node çıktısı `NodeCalistir` içinde UTF-8 olarak okunuyor.
- Betik dosyası ASCII kalmalı ve desen eşleştirmeleri `-cmatch` olmalı (Türkçe `I/ı` sorunu).
- PowerShell 4'te `Invoke-WebRequest` HTTPS'te TLS hatası verebilir; dış istekler için node kullanın.

## Lisans

ISC
