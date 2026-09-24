# secrets/ — gizli bilgiler

Bu klasör uygulamanın **tüm** gizli bilgilerini tutar ve `.gitignore` ile git dışında
bırakılmıştır. Buradaki dosyaları commit etmeyin, e-posta veya mesajla göndermeyin.

## İçerik

| Dosya | Ne var |
|---|---|
| `.env` | Ayarlar ve anahtarlar (aşağıdaki tablo) |
| `users.json` | Kullanıcı adları ve **bcrypt ile hash'lenmiş** şifreler |

## `.env` içindeki anahtarlar

| Anahtar | Ne işe yarar | Gizli mi |
|---|---|---|
| `SESSION_SECRET` | Oturum çerezlerini imzalar. Değişirse herkesin oturumu kapanır. | **Evet** |
| `INTERNAL_TOKEN` | `price_updater`'ın sunucuyu tetiklerken kullandığı anahtar. | **Evet** |
| `TELEGRAM_BOT_TOKEN` | Telegram botunun anahtarı. Ele geçirilirse bot devralınır. | **Evet** |
| `TELEGRAM_CHAT_ID` | Bildirimin gideceği sohbet. | Hayır |
| `SERVER_URL`, `PORT` | Sunucu adresi ve portu. | Hayır |
| `DB_PATH` | Veritabanı yolu (proje köküne göre). | Hayır |
| `BINANCE_API_URL` | Binance API adresi. | Hayır |
| `UPDATE_TIME`, `TIMEZONE` | Referans anı ve saat dilimi. | Hayır |
| `ALERT_*` | Telegram bildirim eşikleri. | Hayır |

Örnek dosya: [`deploy/ornek.env`](../deploy/ornek.env)

## Kullanıcı şifreleri

`users.json` içinde şifreler **düz metin olarak tutulmaz**, bcrypt hash'i olarak saklanır
(`$2b$12$...`). Hash'ten şifre geri çıkarılamaz; bu bilinçli bir güvenlik tercihidir.
Şifre unutulursa yenisi atanır:

```
node src/scripts/kullanici_ekle.js <kullanici_adi>
```

Aynı komut yeni kullanıcı da ekler.

## Anahtar değiştirme

`SESSION_SECRET` veya `INTERNAL_TOKEN` yenilenecekse `.env` içinde değeri değiştirip
sunucuyu yeniden başlatın (`yeniden_baslat.bat`). `INTERNAL_TOKEN` değişince gece çalışan
fiyat güncelleme görevi de yeni değeri kullanır, ek bir işlem gerekmez.

## Yedek

Bu klasörün ve `data/crypto.db` dosyasının yedeğini alın. Kurulum paketi bu dosyaları
**içermez**; güncelleme sırasında oldukları gibi korunurlar.
