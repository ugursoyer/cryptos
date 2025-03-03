const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

// Veritabanı bağlantısı
const db = new sqlite3.Database('crypto.db', async (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    process.exit(1);
  }

  try {
    // Manuel olarak bugünün tarihini al
    const date = '2025-03-02'; // Bugünün tarihi
    
    // Dünün timestamp'ini hesapla (24 saat öncesi)
    const yesterday = new Date().getTime() - (24 * 60 * 60 * 1000);
    
    console.log(`${date} tarihli fiyatlar alınıyor...`);
    
    // Önce sembolleri al
    const symbolsResponse = await axios.get('https://api.binance.com/api/v3/ticker/price');
    const symbols = symbolsResponse.data
      .filter(item => item.symbol.endsWith('USDT'))
      .map(item => item.symbol);
    
    // Her sembol için son 24 saatlik kline verilerini al
    const prices = [];
    for (const symbol of symbols) {
      try {
        const response = await axios.get('https://api.binance.com/api/v3/klines', {
          params: {
            symbol: symbol,
            interval: '1d',  // Günlük mum
            startTime: yesterday,
            limit: 1
          }
        });
        
        if (response.data && response.data.length > 0) {
          const [
            openTime,
            open,
            high,
            low,
            close,
            volume,
            closeTime,
            quoteVolume,
            trades,
            takerBuyBaseVolume,
            takerBuyQuoteVolume
          ] = response.data[0];
          
          prices.push({
            symbol,
            price: parseFloat(close),
            openPrice: parseFloat(open),
            closeTime: closeTime
          });
        }
        
        // Rate limit aşımını önlemek için kısa bekleme
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        console.error(`${symbol} için veri alınamadı:`, error.message);
      }
    }
    
    // Önce tüm kayıtları temizle
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM daily_prices', [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Yeni fiyatları kaydet
    const stmt = db.prepare('INSERT INTO daily_prices (date, symbol, price, open_price, close_time) VALUES (?, ?, ?, ?, ?)');
    prices.forEach(price => {
      stmt.run(date, price.symbol, price.price, price.openPrice, price.closeTime);
    });
    stmt.finalize();

    console.log(`${prices.length} coin fiyatı başarıyla kaydedildi.`);
    
    // Kontrol amaçlı kayıtları göster
    db.all('SELECT DISTINCT date FROM daily_prices', [], (err, rows) => {
      if (err) {
        console.error('Kayıt kontrolü hatası:', err);
      } else {
        console.log('Veritabanındaki tarihler:', rows);
      }
      process.exit(0);
    });
  } catch (error) {
    console.error('Hata:', error);
    process.exit(1);
  }
}); 