const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

// Sabit tarih ve saat
const FIXED_DATE = '2025-03-02';
const FIXED_TIME = '03:00:00';
const TIMESTAMP = new Date(`${FIXED_DATE}T${FIXED_TIME}Z`).getTime();

// Dün gece saat 3'ün timestamp'ini hesapla
const now = new Date();
const yesterday = new Date(now);
yesterday.setDate(now.getDate() - 1);
yesterday.setHours(3, 0, 0, 0);
const yesterdayTimestamp = yesterday.getTime();

// Binance API'den kline (mum) verilerini almak için fonksiyon
async function getKlineData(symbol, interval = '1h', startTime, endTime, limit = 1) {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: {
        symbol,
        interval,
        startTime,
        endTime,
        limit
      }
    });
    
    return response.data;
  } catch (error) {
    console.error(`${symbol} için kline verisi alınamadı:`, error.message);
    return null;
  }
}

// Veritabanı bağlantısı
const db = new sqlite3.Database('crypto.db', async (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    return;
  }
  console.log('SQLite veritabanına bağlandı');
  
  try {
    // Binance'den tüm USDT çiftlerinin listesini al
    console.log('Binance\'den coin listesi alınıyor...');
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price');
    const coins = response.data.filter(item => item.symbol.endsWith('USDT'));
    
    console.log(`Toplam ${coins.length} USDT çifti bulundu.`);
    console.log(`Dün gece saat 3 timestamp: ${yesterdayTimestamp} (${new Date(yesterdayTimestamp).toISOString()})`);
    
    // Transaction başlat
    await new Promise((resolve, reject) => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Tüm coinleri güncelle
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO daily_prices (date, symbol, price, open_price, close_time) 
      VALUES (?, ?, ?, ?, ?)
    `);
    
    let processedCount = 0;
    let successCount = 0;
    
    // Her coin için dün gece saat 3'teki verileri al
    for (const coin of coins) {
      try {
        // API rate limit'e takılmamak için her istekten sonra kısa bir bekleme
        await new Promise(resolve => setTimeout(resolve, 50));
        
        processedCount++;
        if (processedCount % 50 === 0) {
          console.log(`İşlenen: ${processedCount}/${coins.length}`);
        }
        
        // Dün gece saat 3'teki kline verisini al
        const klineData = await getKlineData(
          coin.symbol,
          '1h',
          yesterdayTimestamp - 60000, // 1 dakika öncesi
          yesterdayTimestamp + 3600000, // 1 saat sonrası
          1
        );
        
        if (klineData && klineData.length > 0) {
          // Kline verisi: [open time, open, high, low, close, volume, ...]
          const openPrice = parseFloat(klineData[0][1]); // Açılış fiyatı
          const closePrice = parseFloat(klineData[0][4]); // Kapanış fiyatı
          const closeTime = parseInt(klineData[0][6]); // Kapanış zamanı
          
          // Veritabanına kaydet
          await new Promise((resolve, reject) => {
            stmt.run(
              FIXED_DATE, 
              coin.symbol, 
              openPrice, // Başlangıç fiyatı olarak açılış fiyatını kullan
              openPrice, 
              closeTime, 
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          
          successCount++;
        }
      } catch (error) {
        console.error(`${coin.symbol} işlenirken hata:`, error.message);
      }
    }
    
    // Statement'ı kapat
    await new Promise((resolve, reject) => {
      stmt.finalize((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Transaction'ı tamamla
    await new Promise((resolve, reject) => {
      db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log(`İşlem tamamlandı. ${successCount}/${coins.length} coin için dün gece saat 3 verileri başarıyla kaydedildi.`);
    
    // Örnek olarak bazı coinleri göster
    db.all('SELECT * FROM daily_prices WHERE date = ? LIMIT 10', [FIXED_DATE], (err, rows) => {
      if (err) {
        console.error('Veri okuma hatası:', err);
      } else {
        console.log('Veritabanından örnek kayıtlar:');
        rows.forEach(row => {
          console.log(`${row.symbol}: ${row.price} (Kapanış zamanı: ${new Date(row.close_time).toISOString()})`);
        });
      }
      
      // Veritabanı bağlantısını kapat
      db.close((err) => {
        if (err) {
          console.error('Veritabanı kapatma hatası:', err);
        } else {
          console.log('Veritabanı bağlantısı kapatıldı');
        }
      });
    });
    
  } catch (error) {
    console.error('Hata oluştu:', error);
    
    // Hata durumunda transaction'ı geri al
    db.run('ROLLBACK', (err) => {
      if (err) console.error('Rollback hatası:', err);
    });
    
    // Veritabanı bağlantısını kapat
    db.close((err) => {
      if (err) {
        console.error('Veritabanı kapatma hatası:', err);
      } else {
        console.log('Veritabanı bağlantısı kapatıldı');
      }
    });
  }
}); 