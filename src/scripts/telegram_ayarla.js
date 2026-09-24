// telegram_ayarla.js
// Telegram bildirimlerini kurar: bot token'ını doğrular, sohbet kimliğini
// (chat id) otomatik bulur, .env dosyasına yazar ve deneme mesajı gönderir.
//
// Kullanım:
//   node telegram_ayarla.js          kurulum
//   node telegram_ayarla.js --test   mevcut ayarlarla deneme mesajı gönder
//
// Ön hazırlık (Telegram'da):
//   1. @BotFather ile konuşun, /newbot yazın, bir ad verin -> size token verir.
//   2. Bu betiği çalıştırın, token'ı yapıştırın.
//   3. Betik isteyince oluşturduğunuz botu açıp /start yazın.
//      (Bir gruba göndermek için botu gruba ekleyip grupta bir mesaj yazın.)

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const dotenv = require('dotenv');

const YOL = require('../yollar');
const ENV_PATH = YOL.ENV;
const BEKLEME_SURESI_MS = 120 * 1000;
const TOKEN_DESENI = /^\d+:[A-Za-z0-9_-]{30,}$/;

// Bildirim eşikleri .env'de yoksa bu varsayılanlarla eklenir
const VARSAYILAN_ESIKLER = [
  ['ALERT_MIN_EXCESS', '10', "BTC'den en az kaç puan fazla yükselmiş olmalı"],
  ['ALERT_MIN_VOLUME', '5000000', 'En az 24 saatlik hacim (USDT)'],
  ['ALERT_MAX_FROM_PEAK', '3', 'Tepeden en fazla yüzde kaç uzakta olabilir'],
  ['ALERT_MIN_MOM15', '1', 'Son 15 dakikada en az yüzde kaç yükselmiş olmalı'],
  ['ALERT_COOLDOWN_MIN', '60', 'Aynı coin kaç dakika içinde tekrar bildirilmez']
];

function sor(soru, gizli = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (gizli) {
      rl._writeToOutput = (metin) => {
        if (metin.includes(soru)) process.stdout.write(metin);
      };
    }
    rl.question(soru, (cevap) => {
      rl.close();
      if (gizli) process.stdout.write('\n');
      resolve(cevap.trim());
    });
  });
}

function envOku() {
  if (!fs.existsSync(ENV_PATH)) return {};
  return dotenv.parse(fs.readFileSync(ENV_PATH));
}

// .env'de anahtarı günceller ya da sona ekler; diğer satırlara dokunmaz
function envYaz(degerler, aciklamalar = {}) {
  let metin = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const satirSonu = metin.includes('\r\n') ? '\r\n' : '\n';
  const eklenecek = [];

  for (const [anahtar, deger] of Object.entries(degerler)) {
    const desen = new RegExp(`^${anahtar}=.*$`, 'm');
    if (desen.test(metin)) {
      metin = metin.replace(desen, `${anahtar}=${deger}`);
    } else {
      if (aciklamalar[anahtar]) eklenecek.push(`# ${aciklamalar[anahtar]}`);
      eklenecek.push(`${anahtar}=${deger}`);
    }
  }

  if (eklenecek.length) {
    metin = metin.replace(/\s*$/, '') + satirSonu + satirSonu + eklenecek.join(satirSonu) + satirSonu;
  }

  const gecici = `${ENV_PATH}.tmp`;
  fs.writeFileSync(gecici, metin, 'utf8');
  fs.renameSync(gecici, ENV_PATH);
}

function api(token, metod, params = {}) {
  return axios.get(`https://api.telegram.org/bot${token}/${metod}`, { params, timeout: 35000 })
    .then((r) => r.data.result);
}

async function mesajGonder(token, chatId, text) {
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  }, { timeout: 10000 });
}

function hataMetni(error) {
  if (error.response && error.response.data && error.response.data.description) {
    return `${error.response.status}: ${error.response.data.description}`;
  }
  return error.message;
}

// Bota yazılan mesajlardan sohbetleri toplar
function sohbetleriTopla(guncellemeler, sohbetler) {
  for (const g of guncellemeler) {
    const kaynak = g.message || g.edited_message || g.channel_post || g.my_chat_member;
    const chat = kaynak && kaynak.chat;
    if (!chat) continue;
    const ad = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
    sohbetler.set(String(chat.id), `${ad} (${chat.type})`);
  }
}

async function test() {
  const env = envOku();
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatIds = (env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!token || chatIds.length === 0) {
    console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID .env dosyasında yok. Önce: node telegram_ayarla.js');
    process.exit(1);
  }
  for (const chatId of chatIds) {
    await mesajGonder(token, chatId, '✅ Cryptos deneme mesajı. Bildirimler bu sohbete gelecek.');
    console.log(`Deneme mesajı gönderildi: ${chatId}`);
  }
}

async function kur() {
  const env = envOku();

  // 1. Token
  let token = env.TELEGRAM_BOT_TOKEN;
  if (token) {
    const cevap = await sor(`.env'de kayıtlı bir bot token'ı var. Onu kullanayım mı? (E/H) `);
    if (!/^[EeYy]/.test(cevap)) token = '';
  }
  if (!token) {
    console.log("Telegram'da @BotFather ile konuşup /newbot yazın; size bir token verecek.");
    console.log('Yapıştırmak için pencereye sağ tıklayın (Ctrl+V her konsolda çalışmaz).');
    console.log("Token'ınız yoksa boş bırakıp Enter'a basın; kurulum atlanır.");
    // Görünür girilir: yapıştırmanın tuttuğu ekranda görülebilsin
    for (let deneme = 1; deneme <= 3; deneme++) {
      token = (await sor('Bot token: ')).replace(/^["'\s]+|["'\s]+$/g, '');
      if (TOKEN_DESENI.test(token)) break;
      // Boş giriş = vazgeçme
      if (!token) {
        console.log('Telegram kurulumu atlandı. Daha sonra: node telegram_ayarla.js');
        process.exit(0);
      }
      console.error(`Bu bir bot token'ına benzemiyor (örnek biçim: 123456789:AAH...). Girilen: "${token}"`);
    }
  }
  if (!TOKEN_DESENI.test(token)) {
    console.error('Geçerli token girilmedi, Telegram kurulumu atlandı. Daha sonra: node telegram_ayarla.js');
    process.exit(1);
  }

  let bot;
  try {
    bot = await api(token, 'getMe');
  } catch (error) {
    console.error(`Token doğrulanamadı: ${hataMetni(error)}`);
    process.exit(1);
  }
  console.log(`Bot doğrulandı: @${bot.username}`);

  // 2. Sohbet kimliği
  console.log('');
  console.log(`Şimdi Telegram'da @${bot.username} botunu açın ve /start yazın.`);
  console.log('(Bir gruba göndermek istiyorsanız botu gruba ekleyip grupta bir mesaj yazın.)');
  console.log(`${BEKLEME_SURESI_MS / 1000} saniye bekleniyor...`);

  const sohbetler = new Map();
  let offset;
  const bitis = Date.now() + BEKLEME_SURESI_MS;
  while (Date.now() < bitis && sohbetler.size === 0) {
    try {
      const guncellemeler = await api(token, 'getUpdates', { timeout: 25, offset });
      sohbetleriTopla(guncellemeler, sohbetler);
      if (guncellemeler.length) offset = guncellemeler[guncellemeler.length - 1].update_id + 1;
    } catch (error) {
      if (error.response && error.response.status === 409) {
        console.error('Bu bota bir webhook tanımlı; mesajlar okunamıyor. Bot için webhook kullanmayın.');
        process.exit(1);
      }
      console.error(`Mesajlar okunamadı: ${hataMetni(error)}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  if (sohbetler.size === 0) {
    console.error('Süre doldu, bota mesaj gelmedi. Betiği tekrar çalıştırın.');
    process.exit(1);
  }

  let chatId;
  const liste = [...sohbetler.entries()];
  if (liste.length === 1) {
    chatId = liste[0][0];
    console.log(`Sohbet bulundu: ${liste[0][1]}`);
  } else {
    liste.forEach(([id, ad], i) => console.log(`  ${i + 1}) ${ad}`));
    const secim = parseInt(await sor('Bildirimler hangisine gitsin? Numara: '), 10);
    if (!(secim >= 1 && secim <= liste.length)) {
      console.error('Geçersiz seçim.');
      process.exit(1);
    }
    chatId = liste[secim - 1][0];
  }

  // 3. Deneme mesajı, sonra kaydet
  try {
    await mesajGonder(token, chatId, '✅ Cryptos bildirimleri bu sohbete gelecek.');
  } catch (error) {
    console.error(`Deneme mesajı gönderilemedi: ${hataMetni(error)}`);
    process.exit(1);
  }

  const yeni = { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId };
  const aciklamalar = {
    TELEGRAM_BOT_TOKEN: 'Telegram bildirimleri (node telegram_ayarla.js ile kuruldu)'
  };
  for (const [anahtar, deger, aciklama] of VARSAYILAN_ESIKLER) {
    if (env[anahtar] === undefined) {
      yeni[anahtar] = deger;
      aciklamalar[anahtar] = aciklama;
    }
  }
  envYaz(yeni, aciklamalar);

  console.log('');
  console.log('Deneme mesajı gönderildi ve ayarlar .env dosyasına kaydedildi.');
  // Kurulum betiği sunucuyu zaten sonradan başlatıyor
  if (process.env.CRYPTOS_KURULUM !== '1') {
    console.log('Bildirimlerin başlaması için sunucuyu yeniden başlatın (yeniden_baslat.bat).');
  }
}

const calistir = process.argv.includes('--test') ? test : kur;
calistir().catch((error) => {
  console.error('Hata:', hataMetni(error));
  process.exit(1);
});
