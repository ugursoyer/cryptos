// src/yollar.js
// Projedeki tüm dosya yollarının ve ayarların tek adresi.
// Her giriş noktası (server.js, price_updater.js, scripts/*) ÖNCE bunu yükler:
// böylece .env tek bir yerden, çalışma dizininden bağımsız olarak okunur.
// (Zamanlanmış görevle başlatıldığında çalışma dizini C:\Windows\System32 olur.)

const path = require('path');
const fs = require('fs');

const KOK = path.join(__dirname, '..');

const SECRETS_DIZINI = path.join(KOK, 'secrets');
const ENV = path.join(SECRETS_DIZINI, '.env');
const USERS = path.join(SECRETS_DIZINI, 'users.json');

// Ayarları yükle. Dosya yoksa dotenv sessizce geçer; varsayılanlar devreye girer.
require('dotenv').config({ path: ENV });

// Zaman dilimi, tarih hesaplarından önce ayarlanmalı
process.env.TZ = process.env.TIMEZONE || 'UTC';

const LOGS = path.join(KOK, 'logs');
const DATA = path.join(KOK, 'data');

// DB_PATH verilmişse proje köküne göre çözülür; verilmemişse data/crypto.db
const DB = process.env.DB_PATH
  ? path.resolve(KOK, process.env.DB_PATH)
  : path.join(DATA, 'crypto.db');

// Eksik klasörleri oluştur (ilk çalıştırmada)
for (const dizin of [SECRETS_DIZINI, LOGS, DATA]) {
  if (!fs.existsSync(dizin)) fs.mkdirSync(dizin, { recursive: true });
}

module.exports = {
  KOK,
  ENV,
  USERS,
  SECRETS: SECRETS_DIZINI,
  LOGS,
  DATA,
  DB,
  VIEWS: path.join(__dirname, 'views'),
  PUBLIC: path.join(__dirname, 'public'),
  // Log dosyaları
  UPDATER_LOG: path.join(LOGS, 'price_updater.log'),
  UPDATER_HATA_LOG: path.join(LOGS, 'price_updater_error.log')
};
