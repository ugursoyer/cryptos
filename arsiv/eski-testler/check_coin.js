const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

// Veritabanı bağlantısı
const db = new sqlite3.Database('crypto.db', async (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    return;
  }
  
  console.log('SQLite veritabanına bağlandı');
  
  // 1. Veritabanındaki mevcut coinleri kontrol et
  db.all('SELECT symbol, price FROM daily_prices WHERE date = ? LIMIT 20', ['2025-03-02'], async (err, rows) => {
    if (err) {
      console.error('Veritabanı sorgu hatası:', err);
      return;
    }
    
    console.log('Veritabanındaki ilk 20 coin:');
    rows.forEach(row => {
      console.log(`${row.symbol}: ${row.price}`);
    });
    
    // 2. Binance'den güncel fiyatları al
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
      const tickers = response.data.filter(ticker => ticker.symbol.endsWith('USDT'));
      
      // Yüksek değişim gösteren coinleri bul
      const highChangers = tickers
        .filter(ticker => Math.abs(parseFloat(ticker.priceChangePercent)) > 10)
        .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
      
      console.log('\nYüksek değişim gösteren coinler (>10%):');
      highChangers.slice(0, 10).forEach(ticker => {
        console.log(`${ticker.symbol}: ${ticker.priceChangePercent}% (${ticker.lastPrice})`);
      });
      
      // 3. Test için bir coin seç ve veritabanına ekle
      if (highChangers.length > 0) {
        const testCoin = highChangers[0]; // En yüksek değişim gösteren coin
        console.log(`\nTest için seçilen coin: ${testCoin.symbol}`);
        
        // Veritabanında bu coin var mı kontrol et
        db.get('SELECT * FROM daily_prices WHERE date = ? AND symbol = ?', 
          ['2025-03-02', testCoin.symbol], (err, row) => {
            if (err) {
              console.error('Sorgu hatası:', err);
              return;
            }
            
            if (row) {
              console.log('Bu coin zaten veritabanında var:');
              console.log(row);
              
              // Coinin başlangıç fiyatını güncelle (test için)
              const oldPrice = parseFloat(row.price);
              const newPrice = oldPrice * 0.5; // %50 düşük bir fiyat (büyük artış göstermesi için)
              
              db.run('UPDATE daily_prices SET price = ? WHERE date = ? AND symbol = ?',
                [newPrice, '2025-03-02', testCoin.symbol], function(err) {
                  if (err) {
                    console.error('Güncelleme hatası:', err);
                    return;
                  }
                  console.log(`Coin fiyatı güncellendi: ${oldPrice} -> ${newPrice}`);
                  console.log('Sunucuyu yeniden başlatın ve bu coini kontrol edin.');
                  db.close();
                });
            } else {
              // Coin veritabanında yoksa ekle
              const price = parseFloat(testCoin.lastPrice) * 0.5; // %50 düşük bir fiyat
              
              db.run('INSERT INTO daily_prices (date, symbol, price) VALUES (?, ?, ?)',
                ['2025-03-02', testCoin.symbol, price], function(err) {
                  if (err) {
                    console.error('Ekleme hatası:', err);
                    return;
                  }
                  console.log(`Yeni coin eklendi: ${testCoin.symbol}, başlangıç fiyatı: ${price}`);
                  console.log('Sunucuyu yeniden başlatın ve bu coini kontrol edin.');
                  db.close();
                });
            }
          });
      } else {
        console.log('Yüksek değişim gösteren coin bulunamadı.');
        db.close();
      }
    } catch (error) {
      console.error('Binance API hatası:', error.message);
      db.close();
    }
  });
}); 