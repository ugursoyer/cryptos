const sqlite3 = require('sqlite3').verbose();

// Veritabanı bağlantısı
const db = new sqlite3.Database('crypto.db', (err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    return;
  }
  
  console.log('SQLite veritabanına bağlandı');
  
  // ADAUSDT fiyatını güncelle
  const date = '2025-03-02';
  const symbol = 'ADAUSDT';
  const newPrice = 0.1; // Çok düşük bir fiyat ayarlıyoruz
  
  // Önce mevcut kaydı kontrol et
  db.get('SELECT * FROM daily_prices WHERE date = ? AND symbol = ?', [date, symbol], (err, row) => {
    if (err) {
      console.error('Sorgu hatası:', err);
      db.close();
      return;
    }
    
    console.log('Güncelleme öncesi ADAUSDT kaydı:');
    console.log(row);
    
    // Fiyatı güncelle
    db.run('UPDATE daily_prices SET price = ? WHERE date = ? AND symbol = ?', [newPrice, date, symbol], function(err) {
      if (err) {
        console.error('Güncelleme hatası:', err);
        db.close();
        return;
      }
      
      console.log(`ADAUSDT fiyatı ${newPrice} olarak güncellendi. Etkilenen satır sayısı: ${this.changes}`);
      
      // Güncelleme sonrası kaydı kontrol et
      db.get('SELECT * FROM daily_prices WHERE date = ? AND symbol = ?', [date, symbol], (err, updatedRow) => {
        if (err) {
          console.error('Sorgu hatası:', err);
        } else {
          console.log('Güncelleme sonrası ADAUSDT kaydı:');
          console.log(updatedRow);
        }
        
        // Veritabanı bağlantısını kapat
        db.close(() => {
          console.log('Veritabanı bağlantısı kapatıldı');
        });
      });
    });
  });
}); 