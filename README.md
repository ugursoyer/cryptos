# Kripto Para Takip Uygulaması

Bu uygulama, kripto para birimlerinin fiyatlarını gerçek zamanlı olarak takip etmenizi ve geçmiş fiyat verilerini görüntülemenizi sağlayan bir web uygulamasıdır.

## Özellikler

- Gerçek zamanlı kripto para fiyat takibi
- Günlük fiyat geçmişi görüntüleme
- Kullanıcı kimlik doğrulama sistemi
- WebSocket bağlantısı ile anlık fiyat güncellemeleri
- SQLite veritabanı ile veri depolama

## Teknik Altyapı

- **Backend**: Node.js + Express.js
- **Frontend**: EJS Template Engine
- **Veritabanı**: SQLite3
- **Gerçek Zamanlı İletişim**: Socket.IO
- **API İstekleri**: Axios
- **Kimlik Doğrulama**: Express Session

## Kurulum

1. Projeyi klonlayın
2. Gerekli bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
3. `.env` dosyasını oluşturun ve gerekli ortam değişkenlerini ayarlayın:
   ```
   SESSION_SECRET=your-secret-key
   TIMEZONE=UTC
   ```
4. Uygulamayı başlatın:
   ```bash
   npm start
   ```

## Sistem Bileşenleri

### 1. Sunucu (server.js)
- Express.js web sunucusu
- Oturum yönetimi
- API endpoint'leri
- WebSocket bağlantıları
- Statik dosya sunumu

### 2. Fiyat Güncelleyici (price_updater.js)
- Günlük fiyat verilerini toplama
- Veritabanına kaydetme
- Otomatik güncelleme işlemleri

### 3. Veritabanı (crypto.db)
- SQLite veritabanı
- Günlük fiyat verilerini saklama
- Kullanıcı bilgilerini depolama

### 4. Kullanıcı Arayüzü (views/)
- EJS template'leri
- Dinamik sayfa içerikleri
- Responsive tasarım

## Kullanım

1. Tarayıcınızda `http://localhost:3000` adresine gidin
2. Giriş yapın veya yeni hesap oluşturun
3. Ana sayfada güncel kripto para fiyatlarını görüntüleyin
4. Geçmiş fiyat verilerini tarih seçerek inceleyin

## Güvenlik

- Oturum tabanlı kimlik doğrulama
- Şifre hashleme (bcrypt)
- Güvenli HTTP başlıkları
- XSS ve CSRF koruması

## Bakım ve Güncelleme

- Fiyat güncellemeleri otomatik olarak yapılır
- Log dosyaları `price_updater.log` içinde tutulur
- Hata durumunda otomatik bildirim sistemi

## Geliştirme

1. Yeni özellikler için branch oluşturun
2. Değişikliklerinizi test edin
3. Pull request gönderin

## Lisans

ISC