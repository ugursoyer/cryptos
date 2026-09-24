// src/server.js
// Yollar ve .env yüklemesi yollar.js'de merkezileştirildi; en başta gelmeli.
const YOL = require('./yollar');
const path = require('path');

console.log(`Zaman dilimi: ${process.env.TZ}`);

const express = require('express');
const session = require('express-session');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
// Price updater modülünü içe aktar
const { updateDailyPrices } = require('./price_updater');
const { createPiyasa } = require('./piyasa');
const { createBildirim } = require('./bildirim');

const piyasa = createPiyasa({ apiUrl: process.env.BINANCE_API_URL || 'https://api.binance.com/api/v3' });
const bildirim = createBildirim({ piyasa });

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Uygulama ayarları
app.set('view engine', 'ejs');
app.set('views', YOL.VIEWS);

// Statik dosyalar
app.use(express.static(YOL.PUBLIC));
// Simge dosyası yok; tarayıcı konsolunda 404 görünmesin
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.urlencoded({ extended: true })); // POST verilerini okuyabilmek için
app.use(express.json()); // JSON verilerini okuyabilmek için

// express-session ayarları
app.use(session({
  secret: process.env.SESSION_SECRET || 'gizli-bir-cumle-olacak-buraya',  // .env dosyasından al
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Gerçek sunucuda https kullanıyorsanız true yapın
}));

// Kullanıcı verilerini yükleyen yardımcı fonksiyon
function getUsers() {
  const data = fs.readFileSync(YOL.USERS, 'utf8');
  return JSON.parse(data);
}

// Oturum kontrolü için middleware (sayfalar: giriş ekranına yönlendirir)
function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Oturum kontrolü (API: yönlendirme yerine 401 JSON döner, fetch bunu anlayabilsin)
function ensureApiAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ error: 'Oturum açmanız gerekiyor' });
}

// Sunucu içi tetikleme: geçerli oturum VEYA .env'deki INTERNAL_TOKEN kabul edilir.
// price_updater.js komut satırından çalıştığında oturumu olmadığı için token kullanır.
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;

function ensureInternalOrAuthenticated(req, res, next) {
  const token = req.get('x-internal-token');
  if (INTERNAL_TOKEN && token && token === INTERNAL_TOKEN) {
    return next();
  }
  return ensureApiAuthenticated(req, res, next);
}

// Ana sayfa yönlendirmesi
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Giriş sayfası
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// bcrypt hash'leri $2a$ / $2b$ / $2y$ ile başlar
const HASH_DESENI = /^\$2[aby]\$\d{2}\$/;

// Giriş işlemi
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const users = getUsers();
    const user = users.find(u => u.username === username);

    let gecerli = false;
    if (user && password) {
      if (HASH_DESENI.test(user.password)) {
        gecerli = await bcrypt.compare(password, user.password);
      } else {
        // users.json henüz hash'lenmemiş: girişi engellemeyelim ama uyaralım.
        // `node hash_users.js` çalıştırıldığında bu dal devre dışı kalır.
        console.warn(`UYARI: "${user.username}" kullanıcısının şifresi düz metin. "node hash_users.js" çalıştırın.`);
        gecerli = password === user.password;
      }
    }

    if (gecerli) {
      // Oturum sabitleme (session fixation) saldırısına karşı oturumu yenile
      return req.session.regenerate(err => {
        if (err) {
          console.error('Oturum yenileme hatası:', err);
          return res.render('login', { error: 'Giriş yapılamadı, tekrar deneyin' });
        }
        req.session.user = { username: user.username };
        res.redirect('/coinstats');
      });
    }

    res.render('login', { error: 'Geçersiz kullanıcı adı veya şifre' });
  } catch (error) {
    console.error('Giriş hatası:', error);
    res.render('login', { error: 'Giriş yapılamadı, tekrar deneyin' });
  }
});

// Çıkış işlemi
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.redirect('/login');
  });
});

// Coin Stats sayfası (grafik ekranı)
app.get('/coinstats', ensureAuthenticated, async (req, res) => {
  try {
    // Veritabanından en son kaydedilen tarih ve saati al
    const dateTimeInfo = await new Promise((resolve, reject) => {
      db.get('SELECT date, MAX(close_time) as close_time FROM daily_prices WHERE date = ? GROUP BY date', [currentDate], (err, row) => {
        if (err) {
          console.error('Tarih ve saat sorgusu hatası:', err);
          reject(err);
          return;
        }
        
        let timeStr = '';
        
        if (row && row.close_time) {
          // Saati HH:MM formatında, TIMEZONE ayarına göre biçimlendir.
          // Elle saat eklenmez: process.env.TZ zaten ayarlı olduğu için
          // eklemek çifte dönüşüm yapıp saati ileri kaydırır.
          timeStr = new Date(row.close_time).toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit'
          });
        }
        
        resolve({ 
          date: currentDate,
          time: timeStr
        });
      });
    });
    
    // Tarihi dd.MM.yyyy formatına dönüştür
    const dateParts = dateTimeInfo.date.split('-');
    const formattedDate = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
    
    // Başlık formatını oluştur
    let pageTitle = `${formattedDate}`;
    if (dateTimeInfo.time) {
      pageTitle += ` ${dateTimeInfo.time}`;
    }
    pageTitle += `'den İtibaren En Çok Yükselen 50 Coin`;
    
    res.render('coinstats', { 
      user: req.session.user,
      pageTitle: pageTitle,
      dateInfo: dateTimeInfo
    });
  } catch (error) {
    console.error('Coinstats sayfası yüklenirken hata:', error);
    res.render('coinstats', { 
      user: req.session.user,
      pageTitle: '',
      dateInfo: { date: currentDate, time: '' }
    });
  }
});

let currentDate = ''; // Güncel tarih

// SQLite veritabanı bağlantısı
const dbPath = YOL.DB;
console.log(`Veritabanı yolu: ${dbPath}`);

// Veritabanı dosyasının varlığını ve yazılabilirliğini kontrol et
try {
  fs.accessSync(dbPath, fs.constants.W_OK);
  console.log(`Veritabanı dosyası mevcut ve yazılabilir: ${dbPath}`);
} catch (error) {
  console.log(`Veritabanı dosyası erişim hatası: ${error.message}`);
  // Eğer dosya yoksa, yeni bir dosya oluşturulacak
  if (error.code === 'ENOENT') {
    console.log('Veritabanı dosyası bulunamadı, yeni bir dosya oluşturulacak.');
  } else {
    console.error(`Veritabanı dosyası yazma izni hatası: ${error.message}`);
  }
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, async (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
  } else {
    console.log('SQLite veritabanına bağlandı');
    // Tablo oluştur
    db.run(`CREATE TABLE IF NOT EXISTS daily_prices (
      date TEXT,
      symbol TEXT,
      price REAL,
      open_price REAL,
      close_time INTEGER,
      PRIMARY KEY (date, symbol)
    )`, (err) => {
      if (err) {
        console.error('Tablo oluşturma hatası:', err);
      } else {
        console.log('Tablo kontrol edildi/oluşturuldu');
        
        // En son tarihi bul ve o tarihe ait fiyatları yükle
        getLatestDate().then(date => {
          if (date) {
            currentDate = date;
            console.log(`En son tarih: ${currentDate}`);
            loadDailyPrices(currentDate);
          } else {
            console.error('Veritabanında tarih bulunamadı');
          }
        }).catch(error => {
          console.error('Tarih sorgulama hatası:', error);
        });
      }
    });
  }
});

// En son tarihi bulan fonksiyon
async function getLatestDate() {
  return new Promise((resolve, reject) => {
    db.get('SELECT MAX(date) as latest_date FROM daily_prices', (err, row) => {
      if (err) {
        console.error('En son tarih sorgusu hatası:', err);
        reject(err);
      } else if (row && row.latest_date) {
        resolve(row.latest_date);
      } else {
        // Eğer veritabanında hiç kayıt yoksa, bugünün tarihini Türkiye saatine göre kullan
        const today = new Date();
        const turkeyDate = today.toLocaleDateString('tr-TR', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit',
          timeZone: 'Europe/Istanbul' 
        }).split('.').reverse().join('-');
        resolve(turkeyDate);
      }
    });
  });
}

// Başlangıç fiyatlarını hafızaya yükleyen fonksiyon
async function loadDailyPrices(date) {
  return new Promise((resolve, reject) => {
    db.all('SELECT symbol, price, open_price, close_time FROM daily_prices WHERE date = ?', [date], (err, rows) => {
      if (err) {
        console.error('Başlangıç fiyatları yüklenirken hata:', err);
        reject(err);
      } else {
        const referanslar = new Map();
        rows.forEach(row => {
          referanslar.set(row.symbol, {
            startPrice: row.price, // Başlangıç fiyatı - değişmeyecek
            closeTime: row.close_time // Referans anı
          });
        });
        piyasa.referanslariAyarla(referanslar);
        console.log(`${rows.length} coin için başlangıç fiyatları hafızaya yüklendi`);
        resolve();
      }
    });
  });
}

// En son tarihin referans fiyatlarını yükler
function referanslariYukle() {
  return getLatestDate().then(date => {
    currentDate = date;
    return loadDailyPrices(currentDate);
  });
}

// Canlı akışı başlat; referanslar yüklenemezse (ör. boş veritabanı) dakikada bir tekrar dene
referanslariYukle()
  .catch(error => console.error('Başlangıç fiyatları yüklenemedi:', error))
  .finally(() => {
    piyasa.baslat();
    bildirim.baslat();
  });

setInterval(() => {
  if (piyasa.referansSayisi() > 0) return;
  referanslariYukle().catch(error => console.error('Referans fiyatları yüklenemedi:', error.message));
}, 60 * 1000);

// En çok yükselenler.
//   minVolume: 24 saatlik USDT hacmi alt sınırı (varsayılan 0)
//   limit:     kaç coin (1-100, varsayılan 50)
app.get('/api/livecoins', ensureApiAuthenticated, (req, res) => {
  try {
    const minVolume = Math.max(0, parseFloat(req.query.minVolume) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    // ek: alarm kurulmuş coinler; ilk 50'ye girmese de yanıta eklenir
    const ekstra = String(req.query.ek || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z0-9]{2,20}$/.test(s))
      .slice(0, 30);
    res.json(piyasa.liste({ minVolume, limit, ekstra }));
  } catch (error) {
    console.error("Error in /api/livecoins:", error);
    res.status(500).json({ error: error.message });
  }
});

// Alarm kurulabilecek coin listesi
app.get('/api/symbols', ensureApiAuthenticated, (req, res) => {
  res.json({ symbols: piyasa.semboller() });
});

// Güncel tarih bilgisini döndüren endpoint
app.get('/api/currentdate', ensureApiAuthenticated, (req, res) => {
  // Veritabanından en son kaydedilen tarih ve saati al
  db.get('SELECT date, MAX(close_time) as close_time FROM daily_prices WHERE date = ? GROUP BY date', [currentDate], (err, row) => {
    if (err) {
      console.error('Tarih ve saat sorgusu hatası:', err);
      return res.status(500).json({ error: err.message });
    }
    
    let timeStr = '';
    
    if (row && row.close_time) {
      // /coinstats ile aynı biçimlendirme: TIMEZONE ayarına göre
      timeStr = new Date(row.close_time).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    res.json({ 
      date: currentDate,
      time: timeStr
    });
  });
});

// Yeni tarih bilgisini yükleyen endpoint (price_updater.js tarafından çağrılır).
// Durum değiştirdiği için GET değil POST; yetkisiz tetiklemeye kapalı.
app.post('/api/reload-date', ensureInternalOrAuthenticated, async (req, res) => {
  try {
    const newDate = (req.body && req.body.date) || req.query.date;

    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      return res.status(400).json({ error: 'Geçerli bir tarih parametresi gerekli (YYYY-MM-DD)' });
    }

    console.log(`Yeni tarih yükleniyor: ${newDate}`);
    
    // Yeni tarihi ayarla
    currentDate = newDate;
    
    // Yeni tarih için fiyatları yükle (canlı akış olduğu gibi devam eder)
    await loadDailyPrices(newDate);

    // Başarılı yanıt
    res.json({
      success: true,
      message: `Tarih ${newDate} olarak güncellendi ve ${piyasa.referansSayisi()} coin için fiyatlar yüklendi`
    });
    
    // Socket.io ile bağlı tüm istemcilere yeni tarih bilgisini gönder
    io.emit('dateUpdated', { date: newDate });
    
  } catch (error) {
    console.error('Tarih yükleme hatası:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manuel fiyat güncelleme endpoint'i
app.post('/api/update-prices', ensureApiAuthenticated, async (req, res) => {
  try {
    // Şu anki tarih ve saati Türkiye saatine göre al
    const now = new Date();
    // Türkiye saatine göre formatla
    const date = now.toLocaleDateString('tr-TR', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      timeZone: 'Europe/Istanbul' 
    }).split('.').reverse().join('-');
    
    const time = now.toLocaleTimeString('tr-TR', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'Europe/Istanbul' 
    });
    
    console.log(`Manuel fiyat güncelleme isteği: ${date} ${time} (Türkiye saati)`);
    
    // Veritabanı dosyasının varlığını ve yazılabilirliğini kontrol et
    const dbPath = YOL.DB;
    try {
      fs.accessSync(dbPath, fs.constants.W_OK);
      console.log(`Veritabanı dosyası mevcut ve yazılabilir: ${dbPath}`);
    } catch (error) {
      console.log(`Veritabanı dosyası erişim hatası: ${error.message}`);
      // Eğer dosya yoksa, yeni bir dosya oluşturulacak
      if (error.code === 'ENOENT') {
        console.log('Veritabanı dosyası bulunamadı, yeni bir dosya oluşturulacak.');
        try {
          // Veritabanı dizininin varlığını kontrol et
          const dbDir = path.dirname(dbPath);
          if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log(`Veritabanı dizini oluşturuldu: ${dbDir}`);
          }
          
          // Boş bir dosya oluştur
          fs.writeFileSync(dbPath, '', { flag: 'w' });
          console.log(`Boş veritabanı dosyası oluşturuldu: ${dbPath}`);
        } catch (createError) {
          console.error(`Veritabanı dosyası oluşturma hatası: ${createError.message}`);
          throw new Error(`Veritabanı dosyası oluşturulamadı: ${createError.message}`);
        }
      } else {
        console.error(`Veritabanı dosyası yazma izni hatası: ${error.message}`);
        throw new Error(`Veritabanı dosyasına yazma izni yok: ${error.message}`);
      }
    }
    
    // İşlem başladı bilgisi gönder (anlık fiyat tek istekle alınır, birkaç saniye sürer)
    io.emit('priceUpdateStarted', {
      message: 'Fiyat güncelleme işlemi başladı',
      date: date,
      time: time
    });

    // Fiyatları güncelle. snapshot: saat dakikaya yuvarlandığı için hedef zaman
    // birkaç saniye geçmişte kalabilir; yine de anlık fiyat kullanılsın.
    console.log('updateDailyPrices fonksiyonu çağrılıyor...');
    try {
      const result = await updateDailyPrices(date, time, null, { snapshot: true });
      console.log('updateDailyPrices fonksiyonu başarıyla tamamlandı:', result);
      
      // Başarılı coin sayısını kontrol et
      if (result.successCount === 0) {
        console.error('Hiçbir coin güncellenemedi!');
        throw new Error('Hiçbir coin güncellenemedi. Lütfen internet bağlantınızı ve Binance API erişimini kontrol edin.');
      }
      
      // Yeni tarihi ayarla
      currentDate = result.date;
      
      // Yeni tarih için fiyatları yükle (canlı akış olduğu gibi devam eder)
      await loadDailyPrices(currentDate);

      // Tarihi dd.MM.yyyy formatına dönüştür
      const dateParts = result.date.split('-');
      const formattedDate = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
      
      // Başlık formatını oluştur
      let pageTitle = `${formattedDate} ${result.time}'den İtibaren En Çok Yükselen 50 Coin`;
      
      // İşlem tamamlandı bilgisi gönder
      console.log('İşlem tamamlandı bilgisi gönderiliyor...');
      io.emit('priceUpdateCompleted', { 
        success: true,
        date: formattedDate,
        time: result.time,
        pageTitle: pageTitle,
        totalCount: result.totalCount,
        successCount: result.successCount,
        errorCount: result.errorCount || 0,
        message: `Fiyat güncelleme işlemi tamamlandı. ${result.successCount}/${result.totalCount} coin güncellendi.`
      });
      
      // Socket.io ile bağlı tüm istemcilere yeni tarih bilgisini gönder
      console.log('Tarih bilgisi gönderiliyor...');
      io.emit('dateUpdated', { 
        date: result.date,
        pageTitle: pageTitle
      });
      
      // Başarılı yanıt
      res.json({ 
        success: true, 
        date: result.date,
        time: result.time,
        pageTitle: pageTitle,
        successCount: result.successCount,
        errorCount: result.errorCount || 0,
        message: `Fiyatlar ${formattedDate} ${result.time} tarihine göre güncellendi. ${result.successCount}/${result.totalCount} coin güncellendi.` 
      });
    } catch (error) {
      console.error('updateDailyPrices fonksiyonu hatası:', error);
      throw error;
    }
  } catch (error) {
    console.error('Manuel fiyat güncelleme hatası:', error);
    
    // Hata bilgisi gönder
    io.emit('priceUpdateError', { 
      error: error.message 
    });
    
    res.status(500).json({ error: error.message });
  }
});

// Sunucu başlatma
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sunucu ${PORT} portunda dinleniyor...`);
});

// Zamanlanmış görevden (baslat.bat) çalışırken: Görev Zamanlayıcı'da "Sonlandır"
// yalnızca cmd.exe'yi kapatır. Node sahipsiz kalıp portu tutmasın diye ebeveyn
// süreç kaybolunca çıkılır.
if (process.env.CRYPTOS_GOREV === '1') {
  const ebeveyn = process.ppid;
  setInterval(() => {
    try {
      process.kill(ebeveyn, 0);
    } catch (e) {
      if (e.code === 'EPERM') return;
      console.log('Başlatıcı süreç kapandı (görev sonlandırıldı), sunucu durduruluyor.');
      process.exit(0);
    }
  }, 2000).unref();
}