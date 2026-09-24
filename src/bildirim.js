// bildirim.js
// Belirli koşulları sağlayan coinler için Telegram bildirimi gönderir.
//
// Bir coin bildirilir, eğer AYNI ANDA:
//   - BTC'ye göre en az ALERT_MIN_EXCESS puan fazla yükselmişse (piyasadan ayrışıyor)
//   - 24 saatlik hacmi en az ALERT_MIN_VOLUME USDT ise (alınıp satılabilir)
//   - Referanstan beri gördüğü tepeye en fazla ALERT_MAX_FROM_PEAK % uzaksa (hareket bitmemiş)
//   - Son 15 dakikada en az ALERT_MIN_MOM15 % yükselmişse (hâlâ yükseliyor)
// Aynı coin ALERT_COOLDOWN_MIN dakika içinde tekrar bildirilmez.
//
// TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID tanımlı değilse modül devre dışıdır.
// Kurulum: node telegram_ayarla.js

const axios = require('axios');

const DEGERLENDIRME_ARALIGI_MS = 30 * 1000;
const MESAJ_BASINA_EN_FAZLA = 10;

function sayi(deger, varsayilan) {
  const n = parseFloat(deger);
  return Number.isFinite(n) ? n : varsayilan;
}

function ayarlariOku(env = process.env) {
  return {
    token: (env.TELEGRAM_BOT_TOKEN || '').trim(),
    chatIds: (env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean),
    minExcess: sayi(env.ALERT_MIN_EXCESS, 10),
    minVolume: sayi(env.ALERT_MIN_VOLUME, 5000000),
    maxFromPeak: sayi(env.ALERT_MAX_FROM_PEAK, 3),
    minMom15: sayi(env.ALERT_MIN_MOM15, 1),
    cooldownMs: sayi(env.ALERT_COOLDOWN_MIN, 60) * 60 * 1000
  };
}

function htmlKacis(metin) {
  return String(metin).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function yuzde(n, isaretli = true) {
  const s = n.toFixed(1).replace('.', ',');
  return (isaretli && n > 0 ? '+' : '') + s + '%';
}

function hacim(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' milyar';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' milyon';
  return Math.round(n / 1e3) + ' bin';
}

// Koşulları sağlayan coinleri döndürür (saf fonksiyon, test edilebilir)
function adaylariSec(liste, ayar) {
  if (liste.stale || liste.btcChange === null) return [];
  return liste.coins.filter((c) =>
    c.excess !== null && c.excess >= ayar.minExcess &&
    c.volume >= ayar.minVolume &&
    c.fromPeak >= -ayar.maxFromPeak &&
    c.mom15 !== null && c.mom15 >= ayar.minMom15
  );
}

function mesajOlustur(coins, btcChange) {
  const satirlar = coins.slice(0, MESAJ_BASINA_EN_FAZLA).map((c) => {
    const taban = c.symbol.replace(/USDT$/, '');
    const link = `https://www.binance.com/tr/trade/${encodeURIComponent(taban)}_USDT?type=spot`;
    const fark = c.excess.toFixed(1).replace('.', ',');
    return `🚀 <a href="${link}"><b>${htmlKacis(taban)}</b></a> ${yuzde(c.change)}` +
      ` (BTC'den ${fark} puan fazla)\n` +
      `    15 dk: ${yuzde(c.mom15)} · tepeden: ${yuzde(c.fromPeak, false)} · hacim: ${hacim(c.volume)} USDT`;
  });
  if (coins.length > MESAJ_BASINA_EN_FAZLA) {
    satirlar.push(`… ve ${coins.length - MESAJ_BASINA_EN_FAZLA} coin daha`);
  }
  return `BTC: ${yuzde(btcChange)}\n\n${satirlar.join('\n\n')}`;
}

async function telegramGonder(token, chatId, text) {
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }, { timeout: 10000 });
}

function createBildirim({ piyasa, env = process.env, gonder = telegramGonder }) {
  const ayar = ayarlariOku(env);
  const sonBildirim = new Map(); // symbol -> ts
  let zamanlayici = null;
  let calisiyor = false;

  const etkin = !!(ayar.token && ayar.chatIds.length);

  async function degerlendir() {
    if (calisiyor) return;
    calisiyor = true;
    try {
      // Hacim filtresi burada uygulanır; ilk 100'e bakmak yeterli
      const liste = piyasa.liste({ minVolume: ayar.minVolume, limit: 100 });
      const now = Date.now();
      const yeni = adaylariSec(liste, ayar).filter((c) => {
        const son = sonBildirim.get(c.symbol);
        return !son || now - son >= ayar.cooldownMs;
      });
      if (yeni.length === 0) return;

      const text = mesajOlustur(yeni, liste.btcChange);
      for (const chatId of ayar.chatIds) {
        try {
          await gonder(ayar.token, chatId, text);
        } catch (error) {
          const detay = error.response ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)}` : error.message;
          console.error(`Telegram bildirimi gönderilemedi (${chatId}): ${detay}`);
          return; // gönderilemediyse bekleme süresini başlatma, sonra tekrar denensin
        }
      }
      yeni.forEach((c) => sonBildirim.set(c.symbol, now));
      console.log(`Telegram bildirimi gönderildi: ${yeni.map((c) => c.symbol).join(', ')}`);
    } catch (error) {
      console.error('Bildirim değerlendirme hatası:', error.message);
    } finally {
      calisiyor = false;
    }
  }

  function baslat() {
    if (!etkin) {
      console.log('Telegram bildirimi kapalı (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID tanımlı değil)');
      return;
    }
    console.log(`Telegram bildirimi açık: BTC'den ≥${ayar.minExcess} puan fazla, hacim ≥${hacim(ayar.minVolume)} USDT, ` +
      `tepeden ≤%${ayar.maxFromPeak}, 15 dk ≥%${ayar.minMom15}, bekleme ${ayar.cooldownMs / 60000} dk`);
    zamanlayici = setInterval(degerlendir, DEGERLENDIRME_ARALIGI_MS);
  }

  function durdur() {
    if (zamanlayici) clearInterval(zamanlayici);
  }

  return { baslat, durdur, degerlendir, etkin, ayar };
}

module.exports = { createBildirim, adaylariSec, mesajOlustur, ayarlariOku, telegramGonder };
