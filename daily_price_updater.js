const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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

// Günlük fiyatları güncelleme fonksiyonu
async function updateDailyPrices() {
  // Bugünün tarihini al (YYYY-MM-DD formatında)
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  
  // Bugün saat 3'ün timestamp'ini hesapla
  const todayAt3AM = new Date(today);
  todayAt3AM.setHours(3, 0, 0, 0);
  const todayAt3AMTimestamp = todayAt3AM.getTime();
  
  console.log(`${dateStr} tarihli fiyatlar güncelleniyor...`);
  console.log(`Saat 3 timestamp: ${todayAt3AMTimestamp} (${new Date(todayAt3AMTimestamp).toISOString()})`);
  
  // Veritabanı bağlantısı
  const db = new sqlite3.Database(path.join(__dirname, 'crypto.db'), async (err) => {
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
      
      // Her coin için saat 3'teki verileri al
      for (const coin of coins) {
        try {
          // API rate limit'e takılmamak için her istekten sonra kısa bir bekleme
          await new Promise(resolve => setTimeout(resolve, 50));
          
          processedCount++;
          if (processedCount % 50 === 0) {
            console.log(`İşlenen: ${processedCount}/${coins.length}`);
          }
          
          // Saat 3'teki kline verisini al
          const klineData = await getKlineData(
            coin.symbol,
            '1h',
            todayAt3AMTimestamp - 60000, // 1 dakika öncesi
            todayAt3AMTimestamp + 3600000, // 1 saat sonrası
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
                dateStr, 
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
      
      console.log(`İşlem tamamlandı. ${successCount}/${coins.length} coin için ${dateStr} tarihli veriler başarıyla kaydedildi.`);
      
      // Güncellendiğine dair log dosyası oluştur
      const logFile = path.join(__dirname, 'price_update.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} - ${dateStr} tarihli veriler güncellendi. ${successCount}/${coins.length} coin işlendi.\n`);
      
    } catch (error) {
      console.error('Hata oluştu:', error);
      
      // Hata durumunda transaction'ı geri al
      db.run('ROLLBACK', (err) => {
        if (err) console.error('Rollback hatası:', err);
      });
      
      // Hata logunu kaydet
      const logFile = path.join(__dirname, 'price_update_error.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} - HATA: ${error.message}\n`);
    } finally {
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
}

// Script doğrudan çalıştırıldığında güncellemeyi hemen yap
if (require.main === module) {
  updateDailyPrices().catch(err => {
    console.error('Güncelleme hatası:', err);
    process.exit(1);
  });
}

module.exports = { updateDailyPrices }; 
// updateDailyPrices(); 