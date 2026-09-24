// piyasa.js
// Binance'ten canlı fiyatları toplar ve "referans anından beri en çok yükselenler"
// listesini, alım-satım kararı için gereken bağlamla birlikte hesaplar:
//   - piyasaya (BTC) göre fark
//   - referanstan beri görülen tepe ve tepeden uzaklık (hareket sürüyor mu?)
//   - son 15 dakikadaki yön
//   - 24 saatlik hacim (alınıp satılabilir mi?)
//
// Veri kaynakları:
//   - Ana kaynak "!ticker_1d@arr" WebSocket akışı. Her saniye YALNIZCA değişen
//     sembolleri gönderir; bu yüzden fiyatlar bir haritada biriktirilir.
//   - Akış 30 sn susarsa bağlantı yenilenir ve akış geri gelene kadar REST ile
//     10 sn'de bir yoklanır. (Eski "!ticker@arr" akışı tam da böyle, hata vermeden
//     susarak emekliye ayrılmıştı.)

const WebSocket = require('ws');
const axios = require('axios');

const AKIS_URL = 'wss://stream.binance.com:9443/ws/!ticker_1d@arr';
const SESSIZLIK_ESIGI_MS = 30 * 1000;
const BEKCI_ARALIGI_MS = 5 * 1000;
const REST_ARALIGI_MS = 10 * 1000;
const YENIDEN_BAGLANMA_MS = 5 * 1000;
const ORNEK_ARALIGI_MS = 30 * 1000;
const MOMENTUM_PENCERESI_MS = 15 * 60 * 1000;
// Sunucu yeni başladıysa momentum bu kadar geçmiş birikmeden gösterilmez
const MOMENTUM_MIN_GECMIS_MS = 10 * 60 * 1000;
const GECMIS_TUTMA_MS = 20 * 60 * 1000;
const TEPE_ESZAMANLI = 4;
const TEPE_HATA_BEKLEME_MS = 60 * 1000;
const OZET_ARALIGI_MS = 60 * 1000;

// Referanstan bu yana geçen süreye göre, 1000 mumu aşmayan en ince aralık
function mumAraligi(gecenMs) {
  const dk = gecenMs / 60000;
  if (dk <= 1000) return '1m';
  if (dk <= 5000) return '5m';
  if (dk <= 15000) return '15m';
  if (dk <= 60000) return '1h';
  return '4h';
}

function createPiyasa({ apiUrl = 'https://api.binance.com/api/v3', akisUrl = AKIS_URL } = {}) {
  const fiyatlar = new Map();    // symbol -> { price, volume, ts }
  let referanslar = new Map();   // symbol -> { startPrice, closeTime }
  let referansSurumu = 0;        // referans değişince eski tepe sonuçlarını yok saymak için
  const canliTepeler = new Map();  // symbol -> referanstan beri gözlenen en yüksek fiyat
  const gecmisTepeler = new Map(); // symbol -> { high } | { bekliyor: true } | { hata: ts }
  const tepeKuyrugu = [];
  let tepeAktif = 0;
  const gecmis = new Map();      // symbol -> [{ ts, price }] momentum için örnekler

  let ws = null;
  let baglantiZamani = 0;
  let sonAkisMesaji = 0;
  let sonVeri = 0;
  let restZamanlayici = null;
  let sonRestBasari = 0;
  let sonOzet = 0;
  const zamanlayicilar = [];

  // --- Fiyat işleme ----------------------------------------------------------

  function fiyatIsle(symbol, price, volume, ts) {
    if (!symbol || !symbol.endsWith('USDT') || !(price > 0)) return;
    fiyatlar.set(symbol, { price, volume: volume || 0, ts });
    if (referanslar.has(symbol)) {
      const tepe = canliTepeler.get(symbol);
      if (tepe === undefined || price > tepe) canliTepeler.set(symbol, price);
    }
  }

  async function restIleYukle() {
    const response = await axios.get(`${apiUrl}/ticker/24hr`, { timeout: 10000 });
    const now = Date.now();
    for (const t of response.data) {
      fiyatIsle(t.symbol, parseFloat(t.lastPrice), parseFloat(t.quoteVolume), now);
    }
    sonVeri = now;
    return response.data.length;
  }

  // --- WebSocket akışı -------------------------------------------------------

  function baglan() {
    const socket = new WebSocket(akisUrl);
    ws = socket;
    baglantiZamani = Date.now();

    socket.on('open', async () => {
      console.log('Binance akışına bağlanıldı');
      // Akış yalnızca değişenleri gönderdiği için başlangıçta tüm fiyatları doldur
      try {
        const adet = await restIleYukle();
        console.log(`${adet} sembolün fiyat ve hacmi yüklendi`);
      } catch (error) {
        console.error('Başlangıç fiyatları alınamadı (akıştan dolacak):', error.message);
      }
    });

    socket.on('message', (data) => {
      let tickers;
      try {
        tickers = JSON.parse(data);
      } catch (error) {
        console.error('Akış mesajı çözümlenemedi:', error.message);
        return;
      }
      if (!Array.isArray(tickers)) return;

      const now = Date.now();
      for (const t of tickers) {
        fiyatIsle(t.s, parseFloat(t.c), parseFloat(t.q), now);
      }
      sonAkisMesaji = now;
      sonVeri = now;

      if (restZamanlayici) {
        clearInterval(restZamanlayici);
        restZamanlayici = null;
        console.log('Binance akışı geri geldi, REST yoklaması durduruldu');
      }

      ozetYaz(now);
    });

    socket.on('error', (error) => {
      console.error('Binance akış hatası:', error.message);
    });

    socket.on('close', () => {
      // Yerine yenisi açıldıysa bu bağlantı için yeniden bağlanma
      if (ws !== socket) return;
      console.log(`Binance akışı kapandı, ${YENIDEN_BAGLANMA_MS / 1000} sn sonra yeniden bağlanılacak`);
      setTimeout(() => {
        if (ws === socket) baglan();
      }, YENIDEN_BAGLANMA_MS);
    });
  }

  function restYoklamasiniBaslat() {
    if (restZamanlayici) return;
    console.log('REST yoklaması başladı (akış gelene kadar)');
    const yokla = () => restIleYukle()
      .then(() => { sonRestBasari = Date.now(); })
      .catch((error) => console.error('REST yoklaması başarısız:', error.message));
    yokla();
    restZamanlayici = setInterval(yokla, REST_ARALIGI_MS);
  }

  // Akış hata vermeden susabiliyor; bekçi bunu yakalar
  function bekci() {
    const now = Date.now();
    const sonHareket = Math.max(sonAkisMesaji, baglantiZamani);
    if (now - sonHareket <= SESSIZLIK_ESIGI_MS) return;

    console.warn(`Binance akışından ${Math.round((now - sonHareket) / 1000)} sn'dir veri gelmiyor; bağlantı yenileniyor`);
    restYoklamasiniBaslat();
    if (ws) {
      const eski = ws;
      ws = null; // eski bağlantının 'close' olayı yeniden bağlanmasın
      eski.terminate();
    }
    baglan();
  }

  // --- Momentum (son 15 dk) --------------------------------------------------

  function ornekle() {
    const now = Date.now();
    for (const [symbol, f] of fiyatlar) {
      let dizi = gecmis.get(symbol);
      if (!dizi) {
        dizi = [];
        gecmis.set(symbol, dizi);
      }
      dizi.push({ ts: now, price: f.price });
      while (dizi.length && now - dizi[0].ts > GECMIS_TUTMA_MS) dizi.shift();
    }
  }

  function momentum15(symbol, price, now) {
    const dizi = gecmis.get(symbol);
    if (!dizi || dizi.length === 0) return null;
    const hedef = now - MOMENTUM_PENCERESI_MS;
    const ornek = dizi.find((o) => o.ts >= hedef) || dizi[dizi.length - 1];
    if (now - ornek.ts < MOMENTUM_MIN_GECMIS_MS) return null;
    return (price / ornek.price - 1) * 100;
  }

  // --- Tepe (referanstan beri en yüksek) -------------------------------------
  // Canlı gözlem, sunucu açıkken olanı yakalar. Sunucu referanstan sonra
  // başladıysa aradaki tepeyi kaçırmamak için ekranda görünen coinlerin
  // geçmişi mum verisinden bir kez tamamlanır.

  function tepeIste(symbol) {
    const ref = referanslar.get(symbol);
    if (!ref || !ref.closeTime) return;
    const durum = gecmisTepeler.get(symbol);
    if (durum && (durum.high !== undefined || durum.bekliyor)) return;
    if (durum && durum.hata && Date.now() - durum.hata < TEPE_HATA_BEKLEME_MS) return;

    gecmisTepeler.set(symbol, { bekliyor: true });
    tepeKuyrugu.push(symbol);
    tepeKuyrugunuIsle();
  }

  function tepeKuyrugunuIsle() {
    while (tepeAktif < TEPE_ESZAMANLI && tepeKuyrugu.length > 0) {
      const symbol = tepeKuyrugu.shift();
      const surum = referansSurumu;
      const ref = referanslar.get(symbol);
      if (!ref) continue;

      tepeAktif++;
      const baslangic = ref.closeTime;
      axios.get(`${apiUrl}/klines`, {
        params: {
          symbol,
          interval: mumAraligi(Date.now() - baslangic),
          startTime: baslangic,
          limit: 1000
        },
        timeout: 10000
      })
        .then((response) => {
          if (surum !== referansSurumu) return; // bu arada referans değişti
          let high = 0;
          for (const mum of response.data) {
            const h = parseFloat(mum[2]);
            if (h > high) high = h;
          }
          gecmisTepeler.set(symbol, { high });
        })
        .catch((error) => {
          if (surum !== referansSurumu) return;
          gecmisTepeler.set(symbol, { hata: Date.now() });
          console.error(`${symbol}: tepe geçmişi alınamadı (${error.response ? 'HTTP ' + error.response.status : error.message})`);
        })
        .finally(() => {
          tepeAktif--;
          tepeKuyrugunuIsle();
        });
    }
  }

  function tepe(symbol) {
    const canli = canliTepeler.get(symbol) || 0;
    const durum = gecmisTepeler.get(symbol);
    const eski = durum && durum.high !== undefined ? durum.high : 0;
    return { fiyat: Math.max(canli, eski), tam: !!(durum && durum.high !== undefined) };
  }

  // --- Dışa açık arayüz ------------------------------------------------------

  function referanslariAyarla(yeni) {
    referanslar = yeni;
    referansSurumu++;
    canliTepeler.clear();
    gecmisTepeler.clear();
    tepeKuyrugu.length = 0;
    for (const [symbol, ref] of referanslar) {
      const f = fiyatlar.get(symbol);
      canliTepeler.set(symbol, Math.max(ref.startPrice, f ? f.price : 0));
    }
  }

  function kaynak(now) {
    if (now - sonAkisMesaji <= SESSIZLIK_ESIGI_MS) return 'akis';
    if (restZamanlayici && now - sonRestBasari <= SESSIZLIK_ESIGI_MS) return 'rest';
    return 'yok';
  }

  function degisim(symbol) {
    const ref = referanslar.get(symbol);
    const f = fiyatlar.get(symbol);
    if (!ref || !f || !ref.startPrice) return null;
    return (f.price / ref.startPrice - 1) * 100;
  }

  // Tek bir coinin ekrana/alarma gidecek tüm alanları
  function coinBilgisi(symbol, now, btcChange) {
    const ref = referanslar.get(symbol);
    const f = fiyatlar.get(symbol);
    if (!ref || !f || !ref.startPrice) return null;

    tepeIste(symbol);
    const change = (f.price / ref.startPrice - 1) * 100;
    const t = tepe(symbol);
    const tepeFiyat = Math.max(t.fiyat, f.price);
    return {
      symbol,
      usd: f.price,
      change,
      openPrice: ref.startPrice,
      closeTime: f.ts,
      volume: f.volume,
      excess: btcChange === null ? null : change - btcChange,
      peakChange: (tepeFiyat / ref.startPrice - 1) * 100,
      fromPeak: (f.price / tepeFiyat - 1) * 100,
      peakComplete: t.tam,
      mom15: momentum15(symbol, f.price, now)
    };
  }

  // En çok yükselenler.
  //   minVolume: 24 saatlik USDT hacmi alt sınırı
  //   ekstra:    listede olmasa da istenen semboller (kullanıcının alarm kurduğu coinler);
  //              ayrı bir dizide döner, grafiği bozmaz
  function liste({ minVolume = 0, limit = 50, ekstra = [] } = {}) {
    const now = Date.now();
    const btcChange = degisim('BTCUSDT');

    const adaylar = [];
    for (const [symbol, ref] of referanslar) {
      const f = fiyatlar.get(symbol);
      if (!f || !ref.startPrice) continue;
      if (f.volume < minVolume) continue;
      adaylar.push({ symbol, change: (f.price / ref.startPrice - 1) * 100 });
    }
    adaylar.sort((a, b) => b.change - a.change);

    const coins = adaylar.slice(0, limit)
      .map(({ symbol }) => coinBilgisi(symbol, now, btcChange))
      .filter(Boolean);

    const listede = new Set(coins.map((c) => c.symbol));
    const extras = ekstra
      .filter((symbol) => !listede.has(symbol))
      .map((symbol) => coinBilgisi(symbol, now, btcChange))
      .filter(Boolean);

    return {
      extras,
      // Tarayıcı saati sunucudan farklı olabilir; tazelik serverTime'a göre hesaplanmalı
      serverTime: now,
      updatedAt: sonVeri || null,
      stale: now - sonVeri > SESSIZLIK_ESIGI_MS,
      source: kaynak(now),
      btcChange,
      referenceCount: referanslar.size,
      coins
    };
  }

  function ozetYaz(now) {
    if (now - sonOzet < OZET_ARALIGI_MS || referanslar.size === 0) return;
    sonOzet = now;
    const l = liste({ minVolume: 0, limit: 3 });
    const ilk3 = l.coins.map((c) => `${c.symbol} ${c.change.toFixed(2)}%`).join(', ');
    const btc = l.btcChange === null ? '-' : `${l.btcChange.toFixed(2)}%`;
    console.log(`Canlı: ${fiyatlar.size} fiyat, kaynak=${l.source}, BTC ${btc}. İlk 3: ${ilk3}`);
  }

  function baslat() {
    baglan();
    zamanlayicilar.push(setInterval(bekci, BEKCI_ARALIGI_MS));
    zamanlayicilar.push(setInterval(ornekle, ORNEK_ARALIGI_MS));
  }

  function durdur() {
    zamanlayicilar.forEach(clearInterval);
    if (restZamanlayici) clearInterval(restZamanlayici);
    if (ws) {
      const eski = ws;
      ws = null;
      eski.terminate();
    }
  }

  // Alarm kurulabilecek semboller (referansı ve canlı fiyatı olanlar)
  function semboller() {
    const liste = [];
    for (const symbol of referanslar.keys()) {
      if (fiyatlar.has(symbol)) liste.push(symbol);
    }
    return liste.sort();
  }

  return {
    baslat,
    durdur,
    semboller,
    referanslariAyarla,
    referansSayisi: () => referanslar.size,
    liste
  };
}

module.exports = { createPiyasa, mumAraligi };
