const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
// Yollar ve .env yüklemesi yollar.js'de merkezileştirildi
const YOL = require('./yollar');

console.log(`Zaman dilimi: ${process.env.TZ}`);

// Binance API URL'sini .env dosyasından al
const BINANCE_API_URL = process.env.BINANCE_API_URL || 'https://api.binance.com/api/v3';

// Geçmiş tarihli güncellemede aynı anda kaç kline isteği uçacak.
// Binance IP limiti dakikada 6000 ağırlık, kline isteğinin ağırlığı 2.
// ~560 coin => ~1120 ağırlık, limitin çok altında kalıyor.
const KLINE_CONCURRENCY = 8;

// Hedef zaman bu kadar yakınsa (veya gelecekteyse) mum verisi yerine anlık
// fiyat kullanılır. Saat dakikaya yuvarlandığı için "şimdi" istenen bir hedef
// 60 sn'den fazla geride kalabilir; eşik bu yüzden birkaç dakika tutuldu.
const SNAPSHOT_ESIGI_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// SQLite yardımcıları (callback API'sini promise'e çevirir)
// ---------------------------------------------------------------------------

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function stmtRun(stmt, params) {
  return new Promise((resolve, reject) => {
    stmt.run(params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function stmtFinalize(stmt) {
  return new Promise((resolve, reject) => {
    stmt.finalize((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      dbPath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      (err) => {
        if (err) reject(err);
        else resolve(db);
      }
    );
  });
}

function closeDb(db) {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) console.error('Veritabanı kapatma hatası:', err);
      else console.log('Veritabanı bağlantısı kapatıldı');
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Hedef tarih/saat çözümlemesi
// ---------------------------------------------------------------------------

function bugununTarihi() {
  // YYYY-MM-DD formatında, yerel (TIMEZONE) takvime göre
  const now = new Date();
  const yil = now.getFullYear();
  const ay = String(now.getMonth() + 1).padStart(2, '0');
  const gun = String(now.getDate()).padStart(2, '0');
  return `${yil}-${ay}-${gun}`;
}

function suankiSaat() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function tarihMetni(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hedefiCoz(customDate, customTime) {
  // Tarih ve saatin ikisi de verilmediyse "en son referans anı" aranır
  const otomatik = !customDate && !customTime;
  let targetDate = customDate || bugununTarihi();
  // Varsayılan 03:00 İstanbul = 00:00 UTC, yani Binance'in günlük mum açılışı
  const targetTime = customTime || process.env.UPDATE_TIME || '03:00';

  const [year, month, day] = targetDate.split('-').map(Number);
  const [hours, minutes] = targetTime.split(':').map(Number);

  if (!year || !month || !day || Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Geçersiz tarih/saat: "${targetDate} ${targetTime}" (beklenen: YYYY-MM-DD HH:MM)`);
  }

  // Bileşenlerden kur: yerel saat diliminde yorumlanır, ay sonu taşması olmaz
  let targetDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);

  // Bugünün referans anı henüz gelmediyse (ör. gece 01:00'de 03:00 referansı)
  // geçerli olan referans bir önceki gününkidir.
  if (otomatik && targetDateTime.getTime() > Date.now()) {
    targetDateTime = new Date(year, month - 1, day - 1, hours, minutes, 0, 0);
    targetDate = tarihMetni(targetDateTime);
  }

  return {
    targetDate,
    targetTime,
    targetTimestamp: targetDateTime.getTime(),
    targetDateTime
  };
}

// ---------------------------------------------------------------------------
// Binance veri kaynakları
// ---------------------------------------------------------------------------

// İşlem gören (TRADING) USDT çiftleri. ticker/price, işlemden kaldırılmış (BREAK)
// çiftleri de son fiyatlarıyla döndürür; bunların mum verisi olmadığı için
// ayıklanmazsa hata gibi sayılır, anlık modda da donmuş fiyatla kaydedilirler.
// Liste alınamazsa null döner ve filtre uygulanmaz.
async function islemGorenSemboller() {
  try {
    const response = await axios.get(`${BINANCE_API_URL}/exchangeInfo`, { timeout: 15000 });
    return new Set(
      response.data.symbols
        .filter((s) => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
        .map((s) => s.symbol)
    );
  } catch (error) {
    console.error('İşlem gören çift listesi alınamadı, filtre uygulanmıyor:', error.message);
    return null;
  }
}

// Tüm USDT çiftlerini fiyatlarıyla birlikte TEK istekte getirir.
async function tumTickerlariGetir() {
  const [response, aktifler] = await Promise.all([
    axios.get(`${BINANCE_API_URL}/ticker/price`, { timeout: 10000 }),
    islemGorenSemboller()
  ]);
  const usdt = response.data.filter((item) => item.symbol.endsWith('USDT'));
  const secilen = aktifler ? usdt.filter((item) => aktifler.has(item.symbol)) : usdt;
  if (aktifler) {
    console.log(`${usdt.length - secilen.length} işlem görmeyen çift atlandı.`);
  }
  return secilen.map((item) => ({ symbol: item.symbol, price: parseFloat(item.price) }));
}

// Binance API'ye ulaşılamazsa veritabanındaki sembol listesine düş.
async function coinListesiniGetir(db) {
  try {
    const tickers = await tumTickerlariGetir();
    console.log(`Toplam ${tickers.length} USDT çifti bulundu.`);
    return tickers;
  } catch (error) {
    console.error('Binance API hatası:', error.message);
    console.log('Veritabanından mevcut coinleri almaya çalışılıyor...');

    const rows = await dbAll(db, 'SELECT DISTINCT symbol FROM daily_prices').catch(() => []);
    if (rows.length === 0) {
      throw new Error('Coin listesi alınamadı ve veritabanında kayıtlı coin bulunamadı');
    }

    console.log(`Veritabanından ${rows.length} coin bulundu.`);
    // Fiyat bilgisi yok; yalnızca geçmiş tarihli (kline) güncellemede işe yarar
    return rows.map((row) => ({ symbol: row.symbol, price: null }));
  }
}

// Hedef andaki referans fiyatı 1 dakikalık mumun AÇILIŞINDAN alır.
// 1 saatlik mum kullanılırsa hedef saat başında değilse yanlış mum döner;
// mumun kapanışı kullanılırsa referans 1 saat ileri kayar.
async function referansFiyatiGetir(symbol, targetTimestamp) {
  const istek = (endTime) =>
    axios.get(`${BINANCE_API_URL}/klines`, {
      params: {
        symbol,
        interval: '1m',
        startTime: targetTimestamp,
        endTime,
        limit: 1
      },
      timeout: 10000
    });

  try {
    // Önce hedef dakikanın kendisi
    let response = await istek(targetTimestamp + 60 * 1000);

    // İşlem görmeyen coinlerde o dakika boş olabilir; 1 saatlik pencereye genişlet
    if (!response.data || response.data.length === 0) {
      response = await istek(targetTimestamp + 60 * 60 * 1000);
    }

    if (!response.data || response.data.length === 0) {
      return null;
    }

    // Kline dizisi: [openTime, open, high, low, close, volume, closeTime, ...]
    const mum = response.data[0];
    return {
      price: parseFloat(mum[1]), // açılış = hedef andaki fiyat
      closeTime: parseInt(mum[0]) // referans anı (mumun açılış zamanı)
    };
  } catch (error) {
    if (error.response) {
      console.error(`${symbol}: kline alınamadı (HTTP ${error.response.status})`);
    } else {
      console.error(`${symbol}: kline alınamadı (${error.message})`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sınırlı eşzamanlılıkla iş yürütme
// ---------------------------------------------------------------------------

async function esZamanliIsle(items, limit, worker) {
  const results = new Array(items.length);
  let sirade = 0;

  const yurutucu = async () => {
    while (true) {
      const i = sirade++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, yurutucu)
  );

  return results;
}

// ---------------------------------------------------------------------------
// Veritabanı dosyası hazırlığı
// ---------------------------------------------------------------------------

function veritabaniDosyasiniHazirla(dbPath) {
  try {
    fs.accessSync(dbPath, fs.constants.W_OK);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Veritabanı dosyasına yazma izni yok: ${error.message}`);
    }
  }

  console.log('Veritabanı dosyası bulunamadı, yeni bir dosya oluşturulacak.');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Veritabanı dizini oluşturuldu: ${dbDir}`);
  }
  // Dosyayı sqlite3 OPEN_CREATE ile kendisi oluşturacak; dizin yeterli
}

// ---------------------------------------------------------------------------
// Ana fonksiyon
// ---------------------------------------------------------------------------

// options.snapshot: true ise hedef zamandan bağımsız olarak anlık fiyat kullanılır
// (arayüzdeki "Güncel Fiyatları Kullan" düğmesi).
async function updateDailyPrices(customDate, customTime, progressCallback, options = {}) {
  const { targetDate, targetTime, targetTimestamp, targetDateTime } = hedefiCoz(customDate, customTime);

  // Hedef an geçmişte mi, yoksa "şu an" mı?
  const anlikGoruntu = options.snapshot === true || targetTimestamp >= Date.now() - SNAPSHOT_ESIGI_MS;

  console.log(`${targetDate} ${targetTime} tarihli fiyatlar güncelleniyor...`);
  console.log(`Hedef zaman: ${targetDateTime.toLocaleString('tr-TR')} (${process.env.TZ})`);
  console.log(`Yöntem: ${anlikGoruntu ? 'anlık fiyat (tek istek)' : 'geçmiş mum verisi (coin başına istek)'}`);

  const dbPath = YOL.DB;
  console.log(`Veritabanı yolu: ${dbPath}`);
  veritabaniDosyasiniHazirla(dbPath);

  const db = await openDb(dbPath);
  console.log('SQLite veritabanına bağlandı');

  try {
    // Sunucu aynı dosyayı okurken kilit çakışmasında hemen hata vermek yerine bekle
    await dbRun(db, 'PRAGMA busy_timeout = 10000');

    await dbRun(db, `CREATE TABLE IF NOT EXISTS daily_prices (
      date TEXT,
      symbol TEXT,
      price REAL,
      open_price REAL,
      close_time INTEGER,
      PRIMARY KEY (date, symbol)
    )`);
    console.log('Tablo kontrol edildi/oluşturuldu');

    console.log("Binance'den coin listesi alınıyor...");
    const coins = await coinListesiniGetir(db);

    const bildir = (processedCount, successCount, errorCount) => {
      if (!progressCallback) return;
      progressCallback({
        processedCount,
        totalCount: coins.length,
        successCount,
        errorCount,
        successRate: processedCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : 0
      });
    };

    bildir(0, 0, 0);

    // --- Referans fiyatları topla -----------------------------------------
    let kayitlar;
    let errorCount = 0;

    if (anlikGoruntu) {
      // Coin listesi zaten fiyatlarla geldi; ek istek gerekmiyor.
      const gozlemZamani = Date.now();
      kayitlar = coins
        .filter((coin) => coin.price !== null && !Number.isNaN(coin.price))
        .map((coin) => ({ symbol: coin.symbol, price: coin.price, closeTime: gozlemZamani }));

      errorCount = coins.length - kayitlar.length;
      bildir(coins.length, kayitlar.length, errorCount);
    } else {
      let processedCount = 0;
      let successCount = 0;

      const sonuclar = await esZamanliIsle(coins, KLINE_CONCURRENCY, async (coin) => {
        const referans = await referansFiyatiGetir(coin.symbol, targetTimestamp);

        processedCount++;
        if (referans) successCount++;
        else errorCount++;

        if (processedCount % 25 === 0) {
          console.log(`İşlenen: ${processedCount}/${coins.length}, Başarılı: ${successCount}, Hata: ${errorCount}`);
          bildir(processedCount, successCount, errorCount);
        }

        // O tarihte listelenmemiş coin: anlık fiyatla doldurmak %0 değişim
        // gibi yanıltıcı bir kayıt üretir, bu yüzden atlanıyor.
        if (!referans) return null;

        return { symbol: coin.symbol, price: referans.price, closeTime: referans.closeTime };
      });

      kayitlar = sonuclar.filter((k) => k !== null);
      bildir(coins.length, kayitlar.length, errorCount);
    }

    if (kayitlar.length === 0) {
      throw new Error('Hiçbir coin için referans fiyat alınamadı');
    }

    // --- Tek transaction içinde yaz ---------------------------------------
    await dbRun(db, 'BEGIN TRANSACTION');
    console.log('Transaction başlatıldı');

    try {
      // open_price şema uyumluluğu için korunuyor; referans fiyatla aynı değeri tutar.
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO daily_prices (date, symbol, price, open_price, close_time)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const kayit of kayitlar) {
        await stmtRun(stmt, [targetDate, kayit.symbol, kayit.price, kayit.price, kayit.closeTime]);
      }

      await stmtFinalize(stmt);
      await dbRun(db, 'COMMIT');
      console.log('Transaction başarıyla tamamlandı');
    } catch (error) {
      await dbRun(db, 'ROLLBACK').catch((e) => console.error('Rollback hatası:', e));
      throw error;
    }

    const successCount = kayitlar.length;
    console.log(`İşlem tamamlandı. ${successCount}/${coins.length} coin için ${targetDate} tarihli veriler kaydedildi. ${errorCount} hata oluştu.`);

    fs.appendFileSync(
      YOL.UPDATER_LOG,
      `${new Date().toISOString()} - ${targetDate} ${targetTime} tarihli veriler güncellendi. ${successCount}/${coins.length} coin işlendi, ${errorCount} hata oluştu.\n`
    );

    const result = {
      date: targetDate,
      time: targetTime,
      successCount,
      errorCount,
      totalCount: coins.length
    };

    console.log('updateDailyPrices fonksiyonu sonuç:', result);
    return result;
  } catch (error) {
    console.error('Hata oluştu:', error.message);
    fs.appendFileSync(
      YOL.UPDATER_HATA_LOG,
      `${new Date().toISOString()} - HATA: ${error.message}\n`
    );
    throw error;
  } finally {
    await closeDb(db);
  }
}

// Verilen tarih için veritabanında kayıt var mı?
async function kayitVarMi(date) {
  const dbPath = YOL.DB;
  if (!fs.existsSync(dbPath)) return false;
  const db = await openDb(dbPath);
  try {
    const rows = await dbAll(db, 'SELECT COUNT(*) AS n FROM daily_prices WHERE date = ?', [date]);
    return rows[0].n > 0;
  } catch (error) {
    return false; // tablo yoksa kayıt da yok
  } finally {
    await closeDb(db);
  }
}

// Hedef tarihten sonraki kayıtları siler. Referans saati değiştiğinde, eski saate
// göre yazılmış daha yeni tarihli satır ekranda kullanılmaya devam ederdi.
async function gelecegiSil(date) {
  const dbPath = YOL.DB;
  if (!fs.existsSync(dbPath)) return 0;
  const db = await openDb(dbPath);
  try {
    const sonuc = await dbRun(db, 'DELETE FROM daily_prices WHERE date > ?', [date]);
    return sonuc.changes || 0;
  } catch (error) {
    console.error('Eski kayıtlar silinemedi:', error.message);
    return 0;
  } finally {
    await closeDb(db);
  }
}

// Script doğrudan çalıştırıldığında güncellemeyi hemen yap.
//   node price_updater.js [YYYY-MM-DD] [HH:MM]
//   node price_updater.js --eksikse       bugün için kayıt yoksa çalışır (kurulum betiği kullanır;
//                                         kullanıcının gün içinde seçtiği referansı ezmez)
//   node price_updater.js --gelecegi-sil  güncelleme sonrası daha yeni tarihli kayıtları siler
//                                         (referans saati değiştiğinde kurulum betiği kullanır)
if (require.main === module) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const sadeceEksikse = process.argv.includes('--eksikse');
  const customDate = args[0] || null;
  const customTime = args[1] || null;

  const baslat = sadeceEksikse
    ? kayitVarMi(hedefiCoz(customDate, customTime).targetDate)
    : Promise.resolve(false);

  baslat
    .then((varMi) => {
      if (varMi) {
        console.log('Bu tarih için referans fiyatlar zaten var; değiştirilmedi.');
        process.exit(0);
      }
      return updateDailyPrices(customDate, customTime);
    })
    .then(async (result) => {
      if (process.argv.includes('--gelecegi-sil')) {
        const silinen = await gelecegiSil(result.date);
        if (silinen > 0) console.log(`${result.date} sonrasındaki ${silinen} eski kayıt silindi.`);
      }
      try {
        console.log('Web sunucusuna bildirim gönderiliyor...');
        const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
        const response = await axios.post(
          `${serverUrl}/api/reload-date`,
          { date: result.date },
          { headers: { 'x-internal-token': process.env.INTERNAL_TOKEN || '' }, timeout: 15000 }
        );
        console.log('Sunucu yanıtı:', response.data);
        console.log('Web sunucusu bildirimi tamamlandı.');
      } catch (error) {
        console.error('Web sunucusu bildirimi hatası:', error.message);
      }
    })
    .catch((err) => {
      console.error('Güncelleme hatası:', err.message);
      process.exit(1);
    });
}

module.exports = { updateDailyPrices, suankiSaat, bugununTarihi };
