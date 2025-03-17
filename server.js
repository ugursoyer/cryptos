// server.js
// dotenv paketini yükle
require('dotenv').config();

// Zaman dilimini ayarla
process.env.TZ = process.env.TIMEZONE || 'UTC';
console.log(`Zaman dilimi: ${process.env.TZ}`);

const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const socketIo = require('socket.io');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
// Price updater modülünü içe aktar
const { updateDailyPrices } = require('./price_updater');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Uygulama ayarları
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));
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
  const data = fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8');
  return JSON.parse(data);
}

// Oturum kontrolü için middleware
function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Ana sayfa yönlendirmesi
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Giriş sayfası
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Giriş işlemi
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = getUsers();
  const user = users.find(u => u.username === username);
  if (user) {
    if (password === user.password) {
      req.session.user = { username: user.username };
      return res.redirect('/coinstats');
    }
  }
  res.render('login', { error: 'Geçersiz kullanıcı adı veya şifre' });
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
          // Unix timestamp'i Date objesine çevir ve Türkiye saatine göre ayarla
          const closeTime = new Date(row.close_time);
          closeTime.setHours(closeTime.getHours() + 3); // UTC+3 için 3 saat ekle
          // Saati HH:MM formatında al
          timeStr = `${String(closeTime.getHours()).padStart(2, '0')}:${String(closeTime.getMinutes()).padStart(2, '0')}`;
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

let liveCoinData = []; // Global değişken: canlı veriler burada tutulacak.
let ws; // WebSocket bağlantısı için let ile tanımlıyoruz.
let dailyPriceMap = new Map(); // Başlangıç fiyatlarını tutacak global map
let currentDate = ''; // Güncel tarih

// SQLite veritabanı bağlantısı
const dbPath = path.resolve(__dirname, process.env.DB_PATH || 'crypto.db');
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
        dailyPriceMap.clear(); // Mevcut verileri temizle
        rows.forEach(row => {
          dailyPriceMap.set(row.symbol, {
            startPrice: row.price, // Başlangıç fiyatı - değişmeyecek
            openPrice: row.open_price || row.price, // Eğer open_price null ise price kullan
            closeTime: row.close_time
          });
        });
        console.log(`${rows.length} coin için başlangıç fiyatları hafızaya yüklendi`);
        resolve();
      }
    });
  });
}

// Binance ticker WebSocket'ine bağlanıp, USDT çiftlerini dinleyen fonksiyon:
function connectTickerWebSocket() {
  ws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");

  ws.on('open', () => {
    console.log("Connected to Binance ticker WebSocket");
  });

  ws.on('message', async (data) => {
    try {
      const tickers = JSON.parse(data);
      
      // Eğer başlangıç fiyatları henüz yüklenmedi veya boşsa, işlemi atla
      if (dailyPriceMap.size === 0) {
        console.log('Başlangıç fiyatları henüz yüklenmedi, veritabanı kontrol ediliyor...');
        
        // Veritabanını tekrar kontrol et ve yüklemeyi dene
        try {
          await getLatestDate().then(date => {
            if (date) {
              currentDate = date;
              console.log(`En son tarih: ${currentDate}`);
              return loadDailyPrices(currentDate);
            } else {
              console.error('Veritabanında tarih bulunamadı');
              return Promise.reject('Veritabanında tarih bulunamadı');
            }
          });
          
          // Eğer hala veri yoksa, manuel güncelleme gerektiğini bildir
          if (dailyPriceMap.size === 0) {
            console.error('Veritabanında veri bulunamadı, lütfen "Güncel Fiyatları Kullan" butonuna tıklayarak fiyatları güncelleyin.');
            io.emit('priceUpdateError', { 
              error: 'Veritabanında veri bulunamadı, lütfen "Güncel Fiyatları Kullan" butonuna tıklayarak fiyatları güncelleyin.' 
            });
          } else {
            console.log(`${dailyPriceMap.size} coin için başlangıç fiyatları başarıyla yüklendi`);
          }
        } catch (error) {
          console.error('Veritabanı yeniden yükleme hatası:', error);
        }
        
        return;
      }
      
      // Önce mevcut liveCoinData'daki sembolleri sakla
      const currentTopSymbols = new Set(liveCoinData.map(coin => coin.symbol));
      
      let coins = tickers
        .filter(ticker => ticker && ticker.s && ticker.s.endsWith("USDT"))
        .map(ticker => {
          const symbol = ticker.s;
          const lastPrice = parseFloat(ticker.c);
          const dailyData = dailyPriceMap.get(symbol);
          
          // Eğer coin top listesinde ve dailyData yoksa, eski veriyi koru
          if (currentTopSymbols.has(symbol) && !dailyData) {
            const existingCoin = liveCoinData.find(c => c.symbol === symbol);
            if (existingCoin) {
              return {
                ...existingCoin,
                usd: lastPrice,
                closeTime: parseInt(ticker.C)
              };
            }
          }
          
          if (!dailyData) {
            return null;
          }
          
          // Değişim hesaplaması için başlangıç fiyatını kullan (sabit)
          const change = ((lastPrice - dailyData.startPrice) / dailyData.startPrice) * 100;
          return {
            symbol: symbol,
            usd: lastPrice,
            change: change,
            openPrice: dailyData.startPrice, // Sabit başlangıç fiyatı
            closeTime: parseInt(ticker.C)
          };
        })
        .filter(coin => coin !== null);
      
      // Top listesindeki coinleri koru
      const missingTopCoins = liveCoinData.filter(coin => 
        !coins.some(c => c.symbol === coin.symbol)
      );
      
      coins = [...coins, ...missingTopCoins];
      
      // Azalan sırada sıralama
      coins.sort((a, b) => b.change - a.change);
      // En yüksek yüzdeye sahip 50 coin
      liveCoinData = coins.slice(0, 50);
      
      // Debug için ilk 5 coini göster
      if (liveCoinData.length > 0) {
        console.log('İlk 5 coin değişimleri:');
        liveCoinData.slice(0, 5).forEach(coin => {
          console.log(`${coin.symbol}: ${coin.change.toFixed(2)}% (${coin.openPrice} -> ${coin.usd})`);
        });
      }
      
    } catch (error) {
      console.error("WebSocket message error:", error);
    }
  });

  ws.on('error', (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on('close', () => {
    console.log("Binance ticker WebSocket closed. Reconnecting in 5 seconds...");
    setTimeout(connectTickerWebSocket, 5000);
  });
}

// İlk başlangıç fiyatlarını yükle ve sonra WebSocket'i başlat
getLatestDate().then(date => {
  currentDate = date;
  return loadDailyPrices(currentDate);
}).then(() => {
  connectTickerWebSocket();
}).catch(error => {
  console.error('Başlangıç fiyatları yüklenemedi:', error);
});

// /api/livecoins endpoint'ini global liveCoinData üzerinden döndürün:
app.get('/api/livecoins', async (req, res) => {
  try {
    res.json(liveCoinData || []);
  } catch (error) {
    console.error("Error in /api/livecoins:", error);
    res.status(500).json({ error: error.message });
  }
});

// Güncel tarih bilgisini döndüren endpoint
app.get('/api/currentdate', (req, res) => {
  // Veritabanından en son kaydedilen tarih ve saati al
  db.get('SELECT date, MAX(close_time) as close_time FROM daily_prices WHERE date = ? GROUP BY date', [currentDate], (err, row) => {
    if (err) {
      console.error('Tarih ve saat sorgusu hatası:', err);
      return res.status(500).json({ error: err.message });
    }
    
    let timeStr = '';
    
    if (row && row.close_time) {
      // Unix timestamp'i Date objesine çevir ve Türkiye saatine göre formatla
      const closeTime = new Date(row.close_time);
      // Saati HH:MM formatında Türkiye saatine göre al
      timeStr = closeTime.toLocaleTimeString('tr-TR', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Istanbul' 
      });
    }
    
    res.json({ 
      date: currentDate,
      time: timeStr
    });
  });
});

// Yeni tarih bilgisini yükleyen endpoint (daily_price_updater.js tarafından çağrılır)
app.get('/api/reload-date', async (req, res) => {
  try {
    const newDate = req.query.date;
    
    if (!newDate) {
      return res.status(400).json({ error: 'Tarih parametresi gerekli' });
    }
    
    console.log(`Yeni tarih yükleniyor: ${newDate}`);
    
    // Yeni tarihi ayarla
    currentDate = newDate;
    
    // Yeni tarih için fiyatları yükle
    await loadDailyPrices(newDate);
    
    // WebSocket bağlantısını yenile
    if (ws) {
      ws.terminate();
    }
    connectTickerWebSocket();
    
    // Başarılı yanıt
    res.json({ 
      success: true, 
      message: `Tarih ${newDate} olarak güncellendi ve ${dailyPriceMap.size} coin için fiyatlar yüklendi` 
    });
    
    // Socket.io ile bağlı tüm istemcilere yeni tarih bilgisini gönder
    io.emit('dateUpdated', { date: newDate });
    
  } catch (error) {
    console.error('Tarih yükleme hatası:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manuel fiyat güncelleme endpoint'i
app.post('/api/update-prices', ensureAuthenticated, async (req, res) => {
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
    const dbPath = path.resolve(__dirname, process.env.DB_PATH || 'crypto.db');
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
    
    // Binance'den toplam coin sayısını al
    let totalCoins = 0;
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/price', { timeout: 10000 });
      totalCoins = response.data.filter(ticker => ticker.symbol.endsWith('USDT')).length;
    } catch (error) {
      console.error('Binance API hatası:', error.message);
      totalCoins = 550; // Yaklaşık değer
    }
    
    // İşlem başladı bilgisi gönder
    io.emit('priceUpdateStarted', { 
      message: 'Fiyat güncelleme işlemi başladı',
      totalCount: totalCoins,
      estimatedTime: `Yaklaşık ${Math.ceil(totalCoins / 100)} dakika sürebilir`,
      date: date,
      time: time
    });
    
    // İlerleme bildirimi için callback fonksiyonu
    const progressCallback = (progress) => {
      const percent = Math.round((progress.processedCount / progress.totalCount) * 100);
      const remainingCoins = progress.totalCount - progress.processedCount;
      const estimatedRemainingTime = Math.ceil(remainingCoins / 100);
      
      io.emit('priceUpdateProgress', {
        processedCount: progress.processedCount,
        totalCount: progress.totalCount,
        successCount: progress.successCount,
        errorCount: progress.errorCount || 0,
        percent: percent,
        remainingCoins: remainingCoins,
        estimatedRemainingTime: estimatedRemainingTime > 0 ? `Yaklaşık ${estimatedRemainingTime} dakika kaldı` : 'Tamamlanmak üzere',
        message: `${progress.processedCount}/${progress.totalCount} coin işlendi (${progress.successCount} başarılı)`
      });
    };
    
    // Fiyatları güncelle
    console.log('updateDailyPrices fonksiyonu çağrılıyor...');
    try {
      const result = await updateDailyPrices(date, time, progressCallback);
      console.log('updateDailyPrices fonksiyonu başarıyla tamamlandı:', result);
      
      // Başarılı coin sayısını kontrol et
      if (result.successCount === 0) {
        console.error('Hiçbir coin güncellenemedi!');
        throw new Error('Hiçbir coin güncellenemedi. Lütfen internet bağlantınızı ve Binance API erişimini kontrol edin.');
      }
      
      // Yeni tarihi ayarla
      currentDate = result.date;
      
      // Yeni tarih için fiyatları yükle
      console.log('Yeni tarih için fiyatları yükleme...');
      await loadDailyPrices(currentDate);
      console.log(`${dailyPriceMap.size} coin için fiyatlar hafızaya yüklendi`);
      
      // WebSocket bağlantısını yenile
      if (ws) {
        console.log('WebSocket bağlantısı yenileniyor...');
        ws.terminate();
      }
      connectTickerWebSocket();
      
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