// kullanici_ekle.js
// users.json'a kullanıcı ekler veya mevcut kullanıcının şifresini değiştirir.
// Şifre bcrypt hash'i olarak saklanır.
//
// Kullanım:
//   node kullanici_ekle.js <kullanici_adi>
//
// Şifre CRYPTOS_PASSWORD ortam değişkeninden okunur (kurulum betiği böyle
// kullanır); tanımlı değilse ekranda görünmeden sorulur.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;
const MIN_SIFRE_UZUNLUGU = 8;
const YOL = require('../yollar');
const USERS_PATH = YOL.USERS;

function gizliSor(soru) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Yazılan karakterleri ekrana basma; yalnızca soru metnini göster
    rl._writeToOutput = (metin) => {
      if (metin.includes(soru)) process.stdout.write(metin);
    };
    rl.question(soru, (cevap) => {
      rl.close();
      process.stdout.write('\n');
      resolve(cevap);
    });
  });
}

function kullanicilariOku() {
  if (!fs.existsSync(USERS_PATH)) return [];
  const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  if (!Array.isArray(users)) throw new Error('users.json bir dizi olmalı');
  return users;
}

function kullanicilariYaz(users) {
  // Yarım yazılmış dosya kalmasın: önce geçici dosyaya yaz, sonra taşı
  const gecici = `${USERS_PATH}.tmp`;
  fs.writeFileSync(gecici, JSON.stringify(users, null, 2) + '\n', 'utf8');
  fs.renameSync(gecici, USERS_PATH);
}

async function main() {
  const username = process.argv[2];
  if (!username || !/^[A-Za-z0-9._-]{2,32}$/.test(username)) {
    console.error('Kullanım: node kullanici_ekle.js <kullanici_adi>');
    console.error('Kullanıcı adı 2-32 karakter olmalı; harf, rakam, nokta, alt çizgi, tire içerebilir.');
    process.exit(1);
  }

  let sifre = process.env.CRYPTOS_PASSWORD;
  if (!sifre) {
    sifre = await gizliSor(`"${username}" için şifre: `);
    const tekrar = await gizliSor('Şifre (tekrar): ');
    if (sifre !== tekrar) {
      console.error('Şifreler eşleşmiyor.');
      process.exit(1);
    }
  }

  if (sifre.length < MIN_SIFRE_UZUNLUGU) {
    console.error(`Şifre en az ${MIN_SIFRE_UZUNLUGU} karakter olmalı.`);
    process.exit(1);
  }

  const users = kullanicilariOku();
  const hash = await bcrypt.hash(sifre, SALT_ROUNDS);
  const mevcut = users.find((u) => u.username === username);

  if (mevcut) {
    mevcut.password = hash;
    console.log(`"${username}" kullanıcısının şifresi güncellendi.`);
  } else {
    users.push({ username, password: hash });
    console.log(`"${username}" kullanıcısı eklendi.`);
  }

  kullanicilariYaz(users);
}

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});
