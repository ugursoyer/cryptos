const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('crypto.db', (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    process.exit(1);
  }

  // Yeni sütunları ekle
  db.serialize(() => {
    db.run("ALTER TABLE daily_prices ADD COLUMN open_price REAL", (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('open_price sütunu eklenirken hata:', err);
      } else {
        console.log('open_price sütunu eklendi veya zaten vardı');
      }
    });

    db.run("ALTER TABLE daily_prices ADD COLUMN close_time INTEGER", (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('close_time sütunu eklenirken hata:', err);
      } else {
        console.log('close_time sütunu eklendi veya zaten vardı');
      }
    });

    // İşlem tamamlandığında bağlantıyı kapat
    db.close((err) => {
      if (err) {
        console.error('Veritabanı kapatılırken hata:', err);
      }
      process.exit(0);
    });
  });
}); 