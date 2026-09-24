// hash_users.js
// users.json içindeki düz metin şifreleri bcrypt hash'ine çevirir.
// Zaten hash'lenmiş kayıtlara dokunmaz, tekrar tekrar çalıştırılabilir.
//
// Kullanım:
//   node hash_users.js

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;
const YOL = require('../yollar');
const USERS_PATH = YOL.USERS;

// bcrypt hash'leri $2a$ / $2b$ / $2y$ ile başlar
const HASH_DESENI = /^\$2[aby]\$\d{2}\$/;

async function main() {
  if (!fs.existsSync(USERS_PATH)) {
    console.error(`users.json bulunamadı: ${USERS_PATH}`);
    process.exit(1);
  }

  const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  if (!Array.isArray(users)) {
    console.error('users.json bir dizi olmalı.');
    process.exit(1);
  }

  let degisen = 0;

  for (const user of users) {
    if (!user.password) {
      console.warn(`${user.username}: şifre alanı boş, atlandı.`);
      continue;
    }
    if (HASH_DESENI.test(user.password)) {
      console.log(`${user.username}: zaten hash'lenmiş, atlandı.`);
      continue;
    }
    user.password = await bcrypt.hash(user.password, SALT_ROUNDS);
    console.log(`${user.username}: hash'lendi.`);
    degisen++;
  }

  if (degisen === 0) {
    console.log('Değişiklik yok.');
    return;
  }

  // Önce yedek al, sonra yaz
  const yedek = `${USERS_PATH}.bak`;
  fs.copyFileSync(USERS_PATH, yedek);
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2) + '\n', 'utf8');

  console.log(`\n${degisen} kullanıcı güncellendi.`);
  console.log(`Düz metin yedek: ${yedek}`);
  console.log('Doğruladıktan sonra yedeği SİLİN.');
}

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});
