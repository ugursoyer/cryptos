// server.js
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const socketIo = require('socket.io');
const WebSocket = require('ws');

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

// Binance API dosyasını buraya yerleştir....

let liveCoinData = []; // Global değişken: canlı veriler burada tutulacak.
let ws; // WebSocket bağlantısı için let ile tanımlıyoruz.

// Binance ticker WebSocket'ine bağlanıp, USDT çiftlerini dinleyen fonksiyon:
function connectTickerWebSocket() {
  ws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");

  ws.on('open', () => {
    console.log("Connected to Binance ticker WebSocket");
  });

  ws.on('message', (data) => {
    try {
      // !ticker@arr stream'i bir dizi ticker objesi döndürür.
      const tickers = JSON.parse(data);
      // Sadece tanımlı ticker objelerini ve sembolü "USDT" ile bitenleri filtreleyin.
      let coins = tickers
        .filter(ticker => ticker && ticker.s && ticker.s.endsWith("USDT"))
        .map(ticker => {
          // Binance !ticker@arr stream'inde:
          // ticker.x: önceki kapanış fiyatı
          // ticker.c: güncel fiyat (string)
          const prevClose = parseFloat(ticker.x);
          const lastPrice = parseFloat(ticker.c);
          if (prevClose === 0) return null;
          const change = ((lastPrice - prevClose) / prevClose) * 100;
          const closeTime = parseInt(ticker.C);
          return {
            symbol: ticker.s,
            usd: lastPrice,
            change: change,
            prevClose: prevClose,
            closeTime: closeTime
          };
        })
        .filter(coin => coin !== null);
      // Azalan sırada sıralama:
      coins.sort((a, b) => b.change - a.change);
      // En yüksek yüzdeye sahip 50 coin:
      liveCoinData = coins.slice(0, 50);
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
connectTickerWebSocket();

// /api/livecoins endpoint'ini global liveCoinData üzerinden döndürün:
app.get('/api/livecoins', async (req, res) => {
  try {
    // Global liveCoinData değişkeni WebSocket tarafından güncelleniyor.
    // Eğer WebSocket'ten henüz veri gelmediyse boş dönebilir.
    // Böyle bir durum varsa, varsayılan olarak boş array döndürün.
    res.json(liveCoinData || []);
  } catch (error) {
    console.error("Error in /api/livecoins:", error);
    res.status(500).json({ error: error.message });
  }
});

// Binance API End

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda dinleniyor...`);
});