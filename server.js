// server.js
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const socketIo = require('socket.io');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
// Daily price updater modülünü içe aktar
const { updateDailyPrices } = require('./daily_price_updater');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Uygulama ayarları
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // POST verilerini okuyabilmek için

// express-session ayarları
app.use(session({
  secret: 'gizli-bir-cumle-olacak-buraya',  // Güçlü ve benzersiz bir secret kullanın
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
app.get('/coinstats', ensureAuthenticated, (req, res) => {
  res.render('coinstats', { user: req.session.user });
});

let liveCoinData = []; // Global değişken: canlı veriler burada tutulacak.
let ws; // WebSocket bağlantısı için let ile tanımlıyoruz.
let dailyPriceMap = new Map(); // Başlangıç fiyatlarını tutacak global map
let currentDate = ''; // Güncel tarih

// SQLite veritabanı bağlantısı
const db = new sqlite3.Database('crypto.db', async (err) => {
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
    )`);

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
        // Eğer veritabanında hiç kayıt yoksa, bugünün tarihini kullan
        const today = new Date().toISOString().split('T')[0];
        resolve(today);
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
        console.log('Başlangıç fiyatları henüz yüklenmedi, veriler atlanıyor...');
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
  res.json({ date: currentDate });
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

// Sunucu başlatma
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sunucu ${PORT} portunda dinleniyor...`);
});