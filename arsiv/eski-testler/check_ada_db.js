const sqlite3 = require('sqlite3').verbose();

// Veritabanı bağlantısı
const db = new sqlite3.Database('crypto.db', (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    return;
  }
  console.log('SQLite veritabanına bağlandı');
  
  // ADAUSDT'yi sorgula
  db.get('SELECT * FROM daily_prices WHERE symbol = ? AND date = ?', ['ADAUSDT', '2025-03-02'], (err, row) => {
    if (err) {
      console.error('Sorgu hatası:', err);
    } else if (row) {
      console.log('ADAUSDT veritabanında bulundu:');
      console.log(row);
    } else {
      console.log('ADAUSDT veritabanında bulunamadı');
    }
    
    // Veritabanı bağlantısını kapat
    db.close(() => {
      console.log('Veritabanı bağlantısı kapatıldı');
    });
  });
}); 