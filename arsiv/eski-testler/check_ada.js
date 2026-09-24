const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

// Veritabanı bağlantısı
const db = new sqlite3.Database('crypto.db', async (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    return;
  }
  
  console.log('SQLite veritabanına bağlandı');
  
  // ADAUSDT'yi kontrol et
  db.get('SELECT * FROM daily_prices WHERE date = ? AND symbol = ?', 
    ['2025-03-02', 'ADAUSDT'], async (err, row) => {
      if (err) {
        console.error('Veritabanı sorgu hatası:', err);
        return;
      }
      
      if (row) {
        console.log('ADAUSDT veritabanında bulundu:');
        console.log(row);
        
        try {
          // Binance'den güncel fiyatı al
          const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=ADAUSDT');
          const currentPrice = parseFloat(response.data.price);
          
          console.log(`ADAUSDT güncel fiyat: ${currentPrice}`);
          console.log(`Başlangıç fiyatı: ${row.price}`);
          
          // Değişim yüzdesini hesapla
          const change = ((currentPrice - row.price) / row.price) * 100;
          console.log(`Değişim: ${change.toFixed(2)}%`);
          
          // Veritabanındaki tüm coinleri al ve değişim oranlarına göre sırala
          db.all('SELECT symbol, price FROM daily_prices WHERE date = ?', ['2025-03-02'], async (err, rows) => {
            if (err) {
              console.error('Veritabanı sorgu hatası:', err);
              return;
            }
            
            try {
              // Tüm coinlerin güncel fiyatlarını al
              const tickerResponse = await axios.get('https://api.binance.com/api/v3/ticker/price');
              const tickers = tickerResponse.data;
              
              // Coinlerin değişim oranlarını hesapla
              const changes = [];
              
              for (const dbRow of rows) {
                const ticker = tickers.find(t => t.symbol === dbRow.symbol);
                if (ticker) {
                  const currentPrice = parseFloat(ticker.price);
                  const startPrice = parseFloat(dbRow.price);
                  const changePercent = ((currentPrice - startPrice) / startPrice) * 100;
                  
                  changes.push({
                    symbol: dbRow.symbol,
                    startPrice: startPrice,
                    currentPrice: currentPrice,
                    change: changePercent
                  });
                }
              }
              
              // Değişim oranlarına göre sırala
              changes.sort((a, b) => b.change - a.change);
              
              console.log('\nEn yüksek değişim gösteren 10 coin:');
              changes.slice(0, 10).forEach((coin, index) => {
                console.log(`${index + 1}. ${coin.symbol}: ${coin.change.toFixed(2)}% (${coin.startPrice} -> ${coin.currentPrice})`);
              });
              
              // ADAUSDT'nin sıralamasını bul
              const adaIndex = changes.findIndex(c => c.symbol === 'ADAUSDT');
              if (adaIndex !== -1) {
                console.log(`\nADAUSDT sıralama: ${adaIndex + 1}. sırada`);
              } else {
                console.log('\nADAUSDT sıralamada bulunamadı');
              }
              
              db.close();
            } catch (error) {
              console.error('Binance API hatası:', error.message);
              db.close();
            }
          });
        } catch (error) {
          console.error('Binance API hatası:', error.message);
          db.close();
        }
      } else {
        console.log('ADAUSDT veritabanında bulunamadı');
        db.close();
      }
    });
}); 