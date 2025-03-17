const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
// dotenv paketini yükle
require('dotenv').config();

// Zaman dilimini ayarla
process.env.TZ = process.env.TIMEZONE || 'UTC';
console.log(`Zaman dilimi: ${process.env.TZ}`);

// Binance API URL'sini .env dosyasından al
const BINANCE_API_URL = process.env.BINANCE_API_URL || 'https://api.binance.com/api/v3';

// Binance API'den kline (mum) verilerini almak için fonksiyon
async function getKlineData(symbol, interval = '1h', startTime, endTime, limit = 1) {
  try {
    console.log(`${symbol} için kline verisi alınıyor... Parametreler: interval=${interval}, startTime=${startTime}, endTime=${endTime}`);
    
    const response = await axios.get(`${BINANCE_API_URL}/klines`, {
      params: {
        symbol,
        interval,
        startTime,
        endTime,
        limit
      },
      timeout: 10000 // 10 saniye timeout ekle
    });
    
    if (response.data && response.data.length > 0) {
      console.log(`${symbol} için kline verisi başarıyla alındı.`);
      return response.data;
    } else {
      console.error(`${symbol} için kline verisi boş döndü.`);
      return null;
    }
  } catch (error) {
    // Daha detaylı hata mesajı
    if (error.response) {
      // Sunucu yanıt verdi ama hata kodu döndü
      console.error(`${symbol} için kline verisi alınamadı: Sunucu yanıt kodu ${error.response.status}`);
      console.error(`Hata detayı:`, error.response.data);
    } else if (error.request) {
      // İstek yapıldı ama yanıt alınamadı
      console.error(`${symbol} için kline verisi alınamadı: Sunucudan yanıt alınamadı`);
    } else {
      // İstek oluşturulurken bir hata oluştu
      console.error(`${symbol} için kline verisi alınamadı: ${error.message}`);
    }
    return null;
  }
}

// Günlük fiyatları güncelleme fonksiyonu
async function updateDailyPrices(customDate, customTime, progressCallback) {
  console.log(`updateDailyPrices fonksiyonu başlatıldı: ${customDate} ${customTime}`);
  return new Promise((resolve, reject) => {
    // Tarih ve saat parametrelerini kontrol et
    let targetDate, targetTime;
    
    if (customDate && customTime) {
      // Özel tarih ve saat kullanılıyor
      targetDate = customDate;
      targetTime = customTime;
      console.log(`Özel tarih ve saat kullanılıyor: ${targetDate} ${targetTime}`);
    } else {
      // Bugünün tarihini Türkiye saati olarak al (YYYY-MM-DD formatında)
      const today = new Date();
      // Türkiye saatine göre formatla
      targetDate = today.toLocaleDateString('tr-TR', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        timeZone: 'Europe/Istanbul' 
      }).split('.').reverse().join('-');
      
      // .env dosyasından UPDATE_TIME değerini al veya varsayılan olarak 00:00 kullan
      targetTime = process.env.UPDATE_TIME || '00:00';
    }
    
    // Tarih string'ini Date objesine çevir
    const [year, month, day] = targetDate.split('-').map(Number);
    const [hours, minutes] = targetTime.split(':').map(Number);
    
    // Türkiye saatine göre timestamp oluştur
    const targetDateTime = new Date();
    targetDateTime.setFullYear(year, month - 1, day);
    targetDateTime.setHours(hours, minutes, 0, 0);
    
    // Binance API için UTC timestamp'e çevir
    const targetTimestamp = targetDateTime.getTime();
    
    console.log(`${targetDate} ${targetTime} tarihli fiyatlar güncelleniyor...`);
    console.log(`Hedef zaman (Türkiye): ${targetDateTime.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`Hedef timestamp: ${targetTimestamp}`);
    
    // Veritabanı bağlantısı
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
          reject(createError);
          return;
        }
      } else {
        console.error(`Veritabanı dosyası yazma izni hatası: ${error.message}`);
        reject(error);
        return;
      }
    }
    
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, async (err) => {
      if (err) {
        console.error('Veritabanı bağlantı hatası:', err);
        reject(err);
        return;
      }
      console.log('SQLite veritabanına bağlandı');
      
      try {
        // Tablo oluştur (eğer yoksa)
        await new Promise((resolve, reject) => {
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
              reject(err);
            } else {
              console.log('Tablo kontrol edildi/oluşturuldu');
              resolve();
            }
          });
        });
        
        // Binance'den tüm USDT çiftlerinin listesini al
        console.log('Binance\'den coin listesi alınıyor...');
        let coins = [];
        try {
          const response = await axios.get(`${BINANCE_API_URL}/ticker/price`, { timeout: 10000 });
          coins = response.data.filter(item => item.symbol.endsWith('USDT'));
          console.log(`Toplam ${coins.length} USDT çifti bulundu.`);
        } catch (error) {
          console.error('Binance API hatası:', error.message);
          // Hata durumunda daha önce kaydedilmiş coinleri veritabanından al
          console.log('Veritabanından mevcut coinleri almaya çalışılıyor...');
          const existingCoins = await new Promise((resolve) => {
            db.all('SELECT DISTINCT symbol FROM daily_prices', [], (err, rows) => {
              if (err || !rows || rows.length === 0) {
                console.error('Veritabanından coin listesi alınamadı:', err ? err.message : 'Veri yok');
                resolve([]);
              } else {
                console.log(`Veritabanından ${rows.length} coin bulundu.`);
                resolve(rows.map(row => ({ symbol: row.symbol })));
              }
            });
          });
          
          if (existingCoins.length > 0) {
            coins = existingCoins;
            console.log(`Veritabanından alınan ${coins.length} coin ile devam ediliyor.`);
          } else {
            console.error('Coin listesi alınamadı ve veritabanında kayıtlı coin bulunamadı.');
            throw new Error('Coin listesi alınamadı');
          }
        }
        
        // İlk ilerleme bilgisini gönder
        if (progressCallback) {
          progressCallback({
            processedCount: 0,
            totalCount: coins.length,
            successCount: 0
          });
        }
        
        // Transaction başlat
        await new Promise((resolve, reject) => {
          db.run('BEGIN TRANSACTION', (err) => {
            if (err) {
              console.error('Transaction başlatma hatası:', err);
              reject(err);
            } else {
              console.log('Transaction başlatıldı');
              resolve();
            }
          });
        });
        
        // Tüm coinleri güncelle
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO daily_prices (date, symbol, price, open_price, close_time) 
          VALUES (?, ?, ?, ?, ?)
        `);
        
        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;
        
        // Her coin için belirlenen saatteki verileri al
        for (const coin of coins) {
          try {
            // API rate limit'e takılmamak için her istekten sonra kısa bir bekleme
            await new Promise(resolve => setTimeout(resolve, 100)); // 50ms'den 100ms'ye çıkarıldı
            
            processedCount++;
            
            // Her 5 coinde bir ilerleme bilgisi gönder
            if (processedCount % 5 === 0 && progressCallback) {
              progressCallback({
                processedCount,
                totalCount: coins.length,
                successCount,
                errorCount,
                successRate: successCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : 0
              });
            }
            
            if (processedCount % 50 === 0) {
              console.log(`İşlenen: ${processedCount}/${coins.length}, Başarılı: ${successCount}, Hata: ${errorCount}`);
            }
            
            // Belirlenen saatteki kline verisini al
            const klineData = await getKlineData(
              coin.symbol,
              '1h',
              targetTimestamp - 60000, // 1 dakika öncesi
              targetTimestamp + 3600000, // 1 saat sonrası
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
                  targetDate, 
                  coin.symbol, 
                  closePrice, // Kapanış fiyatını kullan (openPrice yerine)
                  openPrice, 
                  closeTime, 
                  (err) => {
                    if (err) {
                      console.error(`${coin.symbol} için veritabanı yazma hatası:`, err);
                      errorCount++;
                      reject(err);
                    } else {
                      resolve();
                    }
                  }
                );
              });
              
              successCount++;
            } else {
              // Kline verisi alınamadıysa, mevcut fiyatı kullan
              try {
                console.log(`${coin.symbol} için kline verisi alınamadı, mevcut fiyat kullanılacak.`);
                
                // Mevcut fiyatı al
                const tickerResponse = await axios.get(`${BINANCE_API_URL}/ticker/price`, {
                  params: { symbol: coin.symbol },
                  timeout: 5000
                });
                
                if (tickerResponse.data && tickerResponse.data.price) {
                  const currentPrice = parseFloat(tickerResponse.data.price);
                  const now = Date.now();
                  
                  // Veritabanına kaydet
                  await new Promise((resolve, reject) => {
                    stmt.run(
                      targetDate, 
                      coin.symbol, 
                      currentPrice, // Mevcut fiyat
                      currentPrice, // Açılış fiyatı olarak da mevcut fiyatı kullan
                      now, // Şu anki zaman
                      (err) => {
                        if (err) {
                          console.error(`${coin.symbol} için veritabanı yazma hatası (alternatif yöntem):`, err);
                          errorCount++;
                          reject(err);
                        } else {
                          resolve();
                        }
                      }
                    );
                  });
                  
                  console.log(`${coin.symbol} için mevcut fiyat kullanılarak kaydedildi: ${currentPrice}`);
                  successCount++;
                } else {
                  console.error(`${coin.symbol} için mevcut fiyat alınamadı.`);
                  errorCount++;
                }
              } catch (tickerError) {
                console.error(`${coin.symbol} için mevcut fiyat alınırken hata:`, tickerError.message);
                errorCount++;
              }
            }
          } catch (error) {
            console.error(`${coin.symbol} işlenirken hata:`, error.message);
            errorCount++;
          }
        }
        
        // Son ilerleme bilgisini gönder
        if (progressCallback) {
          progressCallback({
            processedCount,
            totalCount: coins.length,
            successCount,
            errorCount,
            successRate: successCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : 0
          });
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
            if (err) {
              console.error('Transaction commit hatası:', err);
              reject(err);
            } else {
              console.log('Transaction başarıyla tamamlandı');
              resolve();
            }
          });
        });
        
        console.log(`İşlem tamamlandı. ${successCount}/${coins.length} coin için ${targetDate} tarihli veriler başarıyla kaydedildi. ${errorCount} hata oluştu.`);
        
        // Güncellendiğine dair log dosyası oluştur
        const logFile = path.join(__dirname, 'price_updater.log');
        fs.appendFileSync(logFile, `${new Date().toISOString()} - ${targetDate} ${targetTime} tarihli veriler güncellendi. ${successCount}/${coins.length} coin işlendi, ${errorCount} hata oluştu.\n`);
        
        // Sonuç nesnesini oluştur
        const result = {
          date: targetDate,
          time: targetTime,
          successCount,
          errorCount,
          totalCount: coins.length
        };
        
        console.log('updateDailyPrices fonksiyonu sonuç:', result);
        resolve(result);
      } catch (error) {
        console.error('Hata oluştu:', error);
        
        // Hata durumunda transaction'ı geri al
        db.run('ROLLBACK', (err) => {
          if (err) console.error('Rollback hatası:', err);
        });
        
        // Hata logunu kaydet
        const logFile = path.join(__dirname, 'price_updater_error.log');
        fs.appendFileSync(logFile, `${new Date().toISOString()} - HATA: ${error.message}\n`);
        
        reject(error);
      } finally {
        // Veritabanı bağlantısını kapat
        db.close((err) => {
          if (err) {
            console.error('Veritabanı kapatma hatası:', err);
            reject(err);
          } else {
            console.log('Veritabanı bağlantısı kapatıldı');
          }
        });
      }
    });
  });
}

// Script doğrudan çalıştırıldığında güncellemeyi hemen yap
if (require.main === module) {
  // Komut satırı argümanlarını kontrol et
  const args = process.argv.slice(2);
  let customDate = null;
  let customTime = null;
  
  // Argümanları işle
  if (args.length >= 1) {
    customDate = args[0];
  }
  
  if (args.length >= 2) {
    customTime = args[1];
  }
  
  updateDailyPrices(customDate, customTime).then(async (result) => {
    try {
      // Veritabanı güncellemesi tamamlandıktan sonra web sunucusuna bildirim yap
      console.log('Web sunucusuna bildirim gönderiliyor...');
      
      // Sunucu adresi - .env dosyasından al
      const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
      
      // Sunucuya bildirim gönder
      const response = await axios.get(`${serverUrl}/api/reload-date?date=${result.date}`);
      console.log('Sunucu yanıtı:', response.data);
      console.log('Web sunucusu bildirimi tamamlandı.');
    } catch (error) {
      console.error('Web sunucusu bildirimi hatası:', error.message);
    }
  }).catch(err => {
    console.error('Güncelleme hatası:', err);
    process.exit(1);
  });
}

module.exports = { updateDailyPrices };