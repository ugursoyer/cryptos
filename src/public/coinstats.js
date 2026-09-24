// public/coinstats.js

// Kaynak: Chart.js datalabels plugin'i
Chart.register(ChartDataLabels);

const GUNCELLEME_ARALIGI_MS = 5000;
// Bir coin "zayıflıyor" sayılır, eğer:
//   - fiyatı tepesinden %5'ten fazla düşmüşse, ya da
//   - referanstan beri kazancının %40'ından fazlasını geri vermişse
//     (tepe en az %2 ise; küçük dalgalanmalar sayılmaz), ya da
//   - son 15 dakikada %1'den fazla gerilemişse
const ZAYIFLAMA_TEPEDEN = -5;
const ZAYIFLAMA_GERI_VERME = 0.4;
const ZAYIFLAMA_MIN_TEPE = 2;
const ZAYIFLAMA_MOM15 = -1;

const RENK = {
  yukselis: { bg: 'rgba(0, 177, 106, 0.7)', border: 'rgba(0, 177, 106, 1)' },
  zayif:    { bg: 'rgba(245, 166, 35, 0.75)', border: 'rgba(245, 166, 35, 1)' },
  negatif:  { bg: 'rgba(235, 54, 54, 0.6)', border: 'rgba(235, 54, 54, 1)' },
  tepe:     'rgba(128, 128, 128, 0.18)',
  btc:      'rgba(74, 144, 226, 0.9)'
};

// Fare ile kullanılan cihazlarda bilgi kutusu görünür; dokunmatik ekranda görünmez
const DOKUNMATIK = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Aynı alarm bu süre dolmadan tekrar çalmaz
const ALARM_BEKLEME_MS = 10 * 60 * 1000;
// Alarmın yeniden kurulması için değerin eşikten bu kadar uzaklaşması gerekir
const ALARM_HISTEREZIS = 0.5;

let currentDate = ''; // Güncel tarih bilgisi
let currentTime = ''; // Güncel saat bilgisi
let frozenOrder = []; // "Sıralamayı dondur" açıkken kullanılan sıra
let sonYanit = null;  // Son /api/livecoins yanıtı
let sonYanitAlinma = 0; // Yanıtın tarayıcıda alındığı an
let baglantiHatasi = false;
let filterSettings = {
  showPositiveOnly: false,
  freezeOrder: false,
  showTop5Only: false,
  minVolume: 1000000
};

// Alarm ayarları tarayıcıda saklanır (her cihaz kendi alarmlarını tutar)
let alarmAyarlari = {
  ses: true,
  genel: { acik: false, esik: 10 },
  coinler: [] // { symbol, yon: 'yukari'|'asagi', esik }
};
const alarmDurumu = new Map(); // anahtar -> { aktif, sonCalma }

// --- Yardımcılar -------------------------------------------------------------

// Oturum düştüyse (ör. sunucu yeniden başladı) giriş sayfasına git
async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Oturum sona erdi');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function yuzde(n, ondalik = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(ondalik).replace('.', ',') + '%';
}

function fiyat(n) {
  if (!(n > 0)) return '—';
  if (n >= 1) return '$' + n.toFixed(4);
  return '$' + n.toPrecision(4);
}

function hacimMetni(n) {
  if (!(n > 0)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' milyar USDT';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' milyon USDT';
  return Math.round(n / 1e3) + ' bin USDT';
}

// Referanstan beri kazancın ne kadarı geri verildi (0-1); tepe yoksa null
function geriVerme(coin) {
  if (!(coin.peakChange > 0)) return null;
  return Math.max(0, (coin.peakChange - coin.change) / coin.peakChange);
}

function zayifliyor(coin) {
  const gv = geriVerme(coin);
  return coin.fromPeak <= ZAYIFLAMA_TEPEDEN ||
    (coin.peakChange >= ZAYIFLAMA_MIN_TEPE && gv !== null && gv >= ZAYIFLAMA_GERI_VERME) ||
    (coin.mom15 !== null && coin.mom15 <= ZAYIFLAMA_MOM15);
}

function renkSec(coin) {
  if (coin.change < 0) return RENK.negatif;
  if (zayifliyor(coin)) return RENK.zayif;
  return RENK.yukselis;
}

// --- Alarmlar ----------------------------------------------------------------

// Sesli uyarı: dosya yerine tarayıcının ses üreteci kullanılır.
// Tarayıcılar sesi ancak kullanıcı sayfayla etkileşime girdikten sonra çalar,
// bu yüzden ilk dokunuşta ses bağlamı hazırlanır.
let sesBaglami = null;

function sesiHazirla() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!sesBaglami) sesBaglami = new AC();
    if (sesBaglami.state === 'suspended') sesBaglami.resume();
    return sesBaglami;
  } catch (error) {
    console.warn('Ses hazırlanamadı:', error);
    return null;
  }
}

function bip(tekrar = 2, zorla = false) {
  if (!alarmAyarlari.ses && !zorla) return;
  const ctx = sesiHazirla();
  if (!ctx) return;
  for (let i = 0; i < tekrar; i++) {
    const t = ctx.currentTime + i * 0.45;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.start(t);
    osc.stop(t + 0.34);
  }
}

function alarmlariYukle() {
  try {
    const kayit = JSON.parse(localStorage.getItem('alarmAyarlari'));
    if (kayit && typeof kayit === 'object') {
      alarmAyarlari = {
        ses: kayit.ses !== false,
        genel: {
          acik: !!(kayit.genel && kayit.genel.acik),
          esik: (kayit.genel && Number(kayit.genel.esik)) || 10
        },
        coinler: Array.isArray(kayit.coinler)
          ? kayit.coinler.filter(a => a && a.symbol && Number.isFinite(Number(a.esik)))
              .map(a => ({ symbol: String(a.symbol), yon: a.yon === 'asagi' ? 'asagi' : 'yukari', esik: Number(a.esik) }))
          : []
      };
    }
  } catch (error) {
    console.warn('Alarm ayarları okunamadı:', error);
  }
}

function alarmlariKaydet() {
  try {
    localStorage.setItem('alarmAyarlari', JSON.stringify(alarmAyarlari));
  } catch (error) {
    console.warn('Alarm ayarları kaydedilemedi:', error);
  }
}

// Alarm kurulan coinler ilk 50'de olmayabilir; sunucudan ayrıca istenir
function alarmSembolleri() {
  return [...new Set(alarmAyarlari.coinler.map(a => a.symbol))];
}

function alarmListesiniCiz() {
  const kutu = document.getElementById('alarmListesi');
  if (!kutu) return;
  kutu.innerHTML = '';
  if (alarmAyarlari.coinler.length === 0) {
    kutu.innerHTML = '<span class="alarm-bos">Coin alarmı yok.</span>';
    return;
  }
  alarmAyarlari.coinler.forEach((alarm, i) => {
    const etiket = document.createElement('span');
    etiket.className = 'alarm-etiket';
    etiket.textContent = `${alarm.symbol.replace(/USDT$/, '')} ${alarm.yon === 'asagi' ? '▼' : '▲'} %${alarm.esik}`;
    const sil = document.createElement('button');
    sil.type = 'button';
    sil.className = 'alarm-sil';
    sil.textContent = '×';
    sil.title = 'Alarmı sil';
    sil.addEventListener('click', () => {
      alarmDurumu.delete('coin:' + alarm.symbol + ':' + i);
      alarmAyarlari.coinler.splice(i, 1);
      alarmlariKaydet();
      alarmListesiniCiz();
    });
    etiket.appendChild(sil);
    kutu.appendChild(etiket);
  });
}

// Son tetiklenen alarmlar; grafiği aşağı itmemesi için tek satırda, en fazla 4 tane
const ALARM_GOSTERIM_ADEDI = 4;
let sonAlarmlar = [];

function alarmBaridiniCiz() {
  const kutu = document.getElementById('alarmBar');
  if (!kutu) return;
  if (sonAlarmlar.length === 0) {
    kutu.style.display = 'none';
    kutu.innerHTML = '';
    return;
  }

  kutu.innerHTML = '<span class="alarm-zil">🔔</span>';
  sonAlarmlar.forEach(a => {
    const parca = document.createElement('span');
    parca.className = 'alarm-parca';
    parca.innerHTML = `<span class="alarm-saat">${a.saat}</span> ${a.metin}`;
    kutu.appendChild(parca);
  });

  const temizle = document.createElement('button');
  temizle.type = 'button';
  temizle.className = 'alarm-sil';
  temizle.textContent = '×';
  temizle.title = 'Uyarıları temizle';
  temizle.addEventListener('click', () => {
    sonAlarmlar = [];
    alarmBaridiniCiz();
  });
  kutu.appendChild(temizle);
  kutu.style.display = 'flex';
}

function alarmGoster(mesajlar) {
  const saat = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  mesajlar.forEach(metin => sonAlarmlar.unshift({ saat, metin }));
  sonAlarmlar = sonAlarmlar.slice(0, ALARM_GOSTERIM_ADEDI);
  alarmBaridiniCiz();
  bip();
}

// Koşul sağlanınca bir kez tetikler; değer eşikten uzaklaşınca yeniden kurulur
function alarmDegerlendir(anahtar, kosul, temizKosul, mesaj, tetiklenenler, now) {
  const durum = alarmDurumu.get(anahtar) || { aktif: false, sonCalma: 0 };
  if (kosul) {
    if (!durum.aktif && now - durum.sonCalma >= ALARM_BEKLEME_MS) {
      tetiklenenler.push(mesaj);
      durum.sonCalma = now;
    }
    durum.aktif = true;
  } else if (temizKosul) {
    durum.aktif = false;
  }
  alarmDurumu.set(anahtar, durum);
}

function alarmlariKontrolEt(coins, extras) {
  const hepsi = [...coins, ...extras];
  const tetiklenenler = [];
  const now = Date.now();

  if (alarmAyarlari.genel.acik) {
    const esik = alarmAyarlari.genel.esik;
    hepsi.forEach(coin => {
      alarmDegerlendir(
        'genel:' + coin.symbol,
        coin.change >= esik,
        coin.change < esik - ALARM_HISTEREZIS,
        `<b>${coin.symbol.replace(/USDT$/, '')}</b> ${yuzde(coin.change)} (eşik %${esik})`,
        tetiklenenler,
        now
      );
    });
  }

  alarmAyarlari.coinler.forEach((alarm, i) => {
    const coin = hepsi.find(c => c.symbol === alarm.symbol);
    if (!coin) return;
    const yukari = alarm.yon === 'yukari';
    alarmDegerlendir(
      'coin:' + alarm.symbol + ':' + i,
      yukari ? coin.change >= alarm.esik : coin.change <= alarm.esik,
      yukari ? coin.change < alarm.esik - ALARM_HISTEREZIS : coin.change > alarm.esik + ALARM_HISTEREZIS,
      `<b>${alarm.symbol.replace(/USDT$/, '')}</b> ${yuzde(coin.change)} — alarm: ${yukari ? '≥' : '≤'} %${alarm.esik}`,
      tetiklenenler,
      now
    );
  });

  if (tetiklenenler.length) alarmGoster(tetiklenenler);
}

async function sembolleriYukle() {
  try {
    const data = await fetchJson('/api/symbols');
    const liste = document.getElementById('coinListesi');
    if (!liste) return;
    liste.innerHTML = '';
    data.symbols.forEach(symbol => {
      const secenek = document.createElement('option');
      secenek.value = symbol.replace(/USDT$/, '');
      liste.appendChild(secenek);
    });
  } catch (error) {
    console.error('Coin listesi alınamadı:', error);
  }
}

function alarmlariKur() {
  const genelAlarm = document.getElementById('genelAlarm');
  const genelEsik = document.getElementById('genelEsik');
  const alarmSesi = document.getElementById('alarmSesi');
  const sesTest = document.getElementById('sesTest');
  const alarmCoin = document.getElementById('alarmCoin');
  const alarmYon = document.getElementById('alarmYon');
  const alarmEsik = document.getElementById('alarmEsik');
  const alarmEkle = document.getElementById('alarmEkle');
  if (!genelAlarm) return;

  genelAlarm.checked = alarmAyarlari.genel.acik;
  genelEsik.value = alarmAyarlari.genel.esik;
  alarmSesi.checked = alarmAyarlari.ses;

  genelAlarm.addEventListener('change', function () {
    alarmAyarlari.genel.acik = this.checked;
    alarmDurumu.clear();
    alarmlariKaydet();
    if (this.checked) sesiHazirla();
  });

  genelEsik.addEventListener('change', function () {
    const deger = parseFloat(this.value);
    if (!Number.isFinite(deger)) { this.value = alarmAyarlari.genel.esik; return; }
    alarmAyarlari.genel.esik = deger;
    alarmDurumu.clear();
    alarmlariKaydet();
  });

  alarmSesi.addEventListener('change', function () {
    alarmAyarlari.ses = this.checked;
    alarmlariKaydet();
    if (this.checked) sesiHazirla();
  });

  sesTest.addEventListener('click', () => bip(1, true));

  alarmEkle.addEventListener('click', () => {
    const ad = (alarmCoin.value || '').trim().toUpperCase();
    const esik = parseFloat(alarmEsik.value);
    if (!ad) { alarmCoin.focus(); return; }
    if (!Number.isFinite(esik)) { alarmEsik.focus(); return; }
    const symbol = ad.endsWith('USDT') ? ad : ad + 'USDT';
    alarmAyarlari.coinler.push({ symbol, yon: alarmYon.value === 'asagi' ? 'asagi' : 'yukari', esik });
    alarmCoin.value = '';
    alarmlariKaydet();
    alarmListesiniCiz();
    sesiHazirla();
    updateMainChart();
  });

  alarmListesiniCiz();
}

// Socket.io bağlantısı
const socket = io();

// Referans tarihi değiştiğinde başlığı ve veriyi yenile
socket.on('dateUpdated', (data) => {
  console.log('Yeni tarih alındı:', data);
  if (data.pageTitle) {
    const titleElement = document.getElementById('pageTitle');
    if (titleElement) titleElement.textContent = data.pageTitle;
  }
  frozenOrder = [];
  updatePageTitle();
  updateMainChart();
});

// Fiyat güncelleme işlemi başladığında
socket.on('priceUpdateStarted', (data) => {
  console.log('Fiyat güncelleme başladı:', data);

  const updateBtn = document.getElementById('updatePrices');
  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Güncelleniyor...';
  }

  showNotification(
    'Fiyat güncelleme işlemi başladı',
    "Güncel fiyatlar Binance'ten alınıyor, birkaç saniye sürer.",
    false,
    'spinner'
  );
});

// Fiyat güncelleme ilerleme bilgisi
socket.on('priceUpdateProgress', (data) => {
  const percent = Math.round((data.processedCount / data.totalCount) * 100);
  showNotification(
    'Fiyat güncelleme işlemi devam ediyor',
    `${data.processedCount}/${data.totalCount} coin işlendi (${percent}%)`,
    false,
    'spinner'
  );
});

// Fiyat güncelleme işlemi tamamlandığında
socket.on('priceUpdateCompleted', (data) => {
  console.log('Fiyat güncelleme tamamlandı:', data);

  const errorCount = data.errorCount || 0;
  showNotification(
    'Fiyat güncelleme işlemi tamamlandı',
    `${data.successCount}/${data.totalCount} coin güncellendi.<br>
    ${errorCount > 0 ? `${errorCount} coin güncellenemedi.<br>` : ''}
    Tarih: ${data.date}<br>
    Saat: ${data.time}`,
    false,
    'check'
  );

  // 2 saniye sonra bildirimi kapat ve sayfayı yenile
  setTimeout(() => {
    hideNotification();
    window.location.reload();
  }, 2000);

  const updateBtn = document.getElementById('updatePrices');
  if (updateBtn) {
    updateBtn.disabled = false;
    updateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Güncel Fiyatları Kullan';
  }
});

// Fiyat güncelleme işlemi hata verdiğinde
socket.on('priceUpdateError', (data) => {
  console.error('Fiyat güncelleme hatası:', data.error);
  showNotification(
    'Fiyat güncelleme hatası',
    `${data.error}<br><br>
    Lütfen şunları kontrol edin:<br>
    - İnternet bağlantınız<br>
    - Binance API erişimi<br>
    - Veritabanı dosyasının yazılabilirliği<br><br>
    Daha sonra tekrar deneyin.`,
    true,
    'error'
  );

  const updateBtn = document.getElementById('updatePrices');
  if (updateBtn) {
    updateBtn.disabled = false;
    updateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Güncel Fiyatları Kullan';
  }

  setTimeout(hideNotification, 5000);
});

// Bildirim panelini göster
function showNotification(title, details, isError = false, iconType = 'spinner') {
  const panel = document.getElementById('notification-panel');
  const messageEl = panel.querySelector('.notification-message');
  const iconEl = panel.querySelector('.notification-icon i');

  let detailsEl = panel.querySelector('.notification-details');
  if (!detailsEl) {
    detailsEl = document.createElement('div');
    detailsEl.className = 'notification-details';
    panel.querySelector('.notification-content').appendChild(detailsEl);
  }

  messageEl.innerHTML = title;
  detailsEl.innerHTML = details;

  if (isError) {
    iconEl.className = 'fas fa-exclamation-triangle';
  } else if (iconType === 'spinner') {
    iconEl.className = 'fas fa-spinner fa-spin';
  } else if (iconType === 'check') {
    iconEl.className = 'fas fa-check-circle';
  } else {
    iconEl.className = 'fas fa-info-circle';
  }

  panel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Bildirim panelini gizle
function hideNotification() {
  const panel = document.getElementById('notification-panel');
  panel.style.display = 'none';
  document.body.style.overflow = '';
}

// Tema değiştirme işlevselliği
function setupThemeToggle() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeIcon = themeToggleBtn.querySelector('i');

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    themeIcon.classList.remove('fa-moon');
    themeIcon.classList.add('fa-sun');
  }

  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');

    if (document.body.classList.contains('dark-theme')) {
      themeIcon.classList.remove('fa-moon');
      themeIcon.classList.add('fa-sun');
      localStorage.setItem('theme', 'dark');
    } else {
      themeIcon.classList.remove('fa-sun');
      themeIcon.classList.add('fa-moon');
      localStorage.setItem('theme', 'light');
    }

    updateChartColors();
  });
}

function ayarlariKaydet() {
  localStorage.setItem('filterSettings', JSON.stringify(filterSettings));
}

// Filtre ayarlarını kurma
function setupFilterToggles() {
  const showPositiveOnlyToggle = document.getElementById('positiveOnly');
  const freezeOrderToggle = document.getElementById('freezeOrder');
  const showTop5Toggle = document.getElementById('showTop5');
  const minVolumeSelect = document.getElementById('minVolume');

  let savedSettings = {};
  try {
    savedSettings = JSON.parse(localStorage.getItem('filterSettings')) || {};
  } catch (e) {
    savedSettings = {};
  }

  if (savedSettings.showPositiveOnly !== undefined) filterSettings.showPositiveOnly = savedSettings.showPositiveOnly;
  if (savedSettings.freezeOrder !== undefined) filterSettings.freezeOrder = savedSettings.freezeOrder;
  if (savedSettings.showTop5Only !== undefined) filterSettings.showTop5Only = savedSettings.showTop5Only;
  if (savedSettings.minVolume !== undefined) filterSettings.minVolume = savedSettings.minVolume;

  showPositiveOnlyToggle.checked = filterSettings.showPositiveOnly;
  freezeOrderToggle.checked = filterSettings.freezeOrder;
  showTop5Toggle.checked = filterSettings.showTop5Only;
  // Kayıtlı değer listede yoksa varsayılana dön
  minVolumeSelect.value = String(filterSettings.minVolume);
  if (minVolumeSelect.value !== String(filterSettings.minVolume)) {
    filterSettings.minVolume = 1000000;
    minVolumeSelect.value = '1000000';
  }

  showPositiveOnlyToggle.addEventListener('change', function() {
    filterSettings.showPositiveOnly = this.checked;
    ayarlariKaydet();
    updatePageTitle();
    grafigiCiz();
  });

  freezeOrderToggle.addEventListener('change', function() {
    filterSettings.freezeOrder = this.checked;
    // Dondurulurken o anki sırayı sabitle
    frozenOrder = this.checked ? mainChart.data.datasets[0].customData.map(coin => coin.symbol) : [];
    ayarlariKaydet();
    grafigiCiz();
  });

  showTop5Toggle.addEventListener('change', function() {
    filterSettings.showTop5Only = this.checked;
    ayarlariKaydet();
    updatePageTitle();
    grafigiCiz();
  });

  minVolumeSelect.addEventListener('change', function() {
    filterSettings.minVolume = parseFloat(this.value) || 0;
    frozenOrder = [];
    ayarlariKaydet();
    updateMainChart();
  });
}

// Grafik renklerini tema değişikliğine göre güncelle
function updateChartColors() {
  const isDarkTheme = document.body.classList.contains('dark-theme');
  if (mainChart) {
    mainChart.options.plugins.datalabels.labels.coinName.color = isDarkTheme ? '#f0f0f0' : 'rgb(38, 38, 38)';
    mainChart.update();
  }
}

// Tarih formatını düzenleyen yardımcı fonksiyon
function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function basligiOlustur() {
  let title = formatDate(currentDate);
  if (currentTime) title += ` ${currentTime}`;
  title += `'den İtibaren En Çok Yükselen ${filterSettings.showTop5Only ? 5 : 50} Coin`;
  if (filterSettings.showPositiveOnly) title += ' - Yalnızca Pozitif Değerler';
  return title;
}

// Sayfa başlığını güncelleyen fonksiyon
async function updatePageTitle() {
  try {
    const data = await fetchJson('/api/currentdate');
    currentDate = data.date;
    currentTime = data.time || '';
    const titleElement = document.getElementById('pageTitle');
    if (titleElement) titleElement.textContent = basligiOlustur();
  } catch (error) {
    console.error("Tarih bilgisi alınamadı:", error);
  }
}

// --- Ana grafik ----------------------------------------------------------------

const ctxMain = document.getElementById('barChart').getContext('2d');
var mainChart = new Chart(ctxMain, {
  // Kök tür 'bar'; BTC çizgisi kendi veri setinde 'line' olarak tanımlı.
  // Kök tür verilmezse x ekseni kategori yerine sayısal kurulup çubuklar sıkışıyor.
  type: 'bar',
  data: {
    labels: [],
    datasets: [
      {
        // 0: Referanstan beri değişim (asıl çubuk)
        type: 'bar',
        label: '% Değişim',
        data: [],
        backgroundColor: [],
        borderColor: [],
        borderWidth: 1,
        grouped: false,
        order: 1,
        customData: []
      },
      {
        // 1: Referanstan beri görülen tepe (arkada soluk çubuk)
        type: 'bar',
        label: 'Tepe',
        data: [],
        backgroundColor: RENK.tepe,
        borderWidth: 0,
        grouped: false,
        order: 2,
        datalabels: { display: false }
      },
      {
        // 2: BTC'nin değişimi (piyasa çizgisi)
        type: 'line',
        label: 'BTC',
        data: [],
        borderColor: RENK.btc,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        order: 0,
        datalabels: { display: false }
      }
    ]
  },
  options: {
    responsive: true,
    animation: { duration: 300 },
    layout: {
      // Döndürülmüş coin adları (en fazla 8 karakter) alt kenarda kırpılmasın
      padding: { bottom: 80 }
    },
    interaction: { mode: 'index', intersect: false },
    // Çubuğa tıklayınca Binance'i açma özelliği kaldırıldı: tablette/telefonda
    // dokunma, sayfadan çıkılmasına yol açıyordu.
    plugins: {
      legend: { display: false },
      datalabels: {
        labels: {
          coinName: {
            anchor: 'start',
            align: 'start',
            rotation: 270,
            offset: 10,
            formatter: (value, context) => {
              const coin = context.chart.data.datasets[0].customData[context.dataIndex];
              if (!coin) return '';
              // Uzun adlar alt kenardan taşmasın; tam ad ipucunda görünür
              const ad = coin.symbol.replace(/USDT$/, '');
              return ad.length > 8 ? ad.slice(0, 7) + '…' : ad;
            },
            color: 'rgb(38, 38, 38)',
            font: { family: 'Helvetica, Arial, sans-serif', weight: 'bold', size: 13 }
          },
          percentage: {
            anchor: 'end',
            align: 'end',
            rotation: 270,
            offset: 2,
            formatter: (value) => value.toFixed(2) + '%',
            color: (context) => {
              const value = context.dataset.data[context.dataIndex];
              return value >= 0 ? 'rgba(0, 177, 106, 1)' : 'rgba(235, 54, 54, 1)';
            },
            font: { family: 'Helvetica, Arial, sans-serif', weight: 'bold', size: 13 }
          }
        }
      },
      tooltip: {
        // Dokunmatik ekranda bilgi kutusu çıkmaz; sadece çubuklar görünür
        enabled: !DOKUNMATIK,
        // Yalnızca asıl çubuğun bilgisini göster
        filter: (item) => item.datasetIndex === 0,
        callbacks: {
          title: (items) => {
            const coin = items.length ? items[0].chart.data.datasets[0].customData[items[0].dataIndex] : null;
            return coin ? `${coin.symbol.replace(/USDT$/, '')} / USDT` : '';
          },
          label: (context) => {
            const coin = context.chart.data.datasets[0].customData[context.dataIndex];
            if (!coin) return '';
            const btc = sonYanit ? sonYanit.btcChange : null;
            const gv = geriVerme(coin);
            const satirlar = [
              `Değişim: ${yuzde(coin.change)}` + (coin.excess !== null ? `  (BTC'ye göre ${coin.excess > 0 ? '+' : ''}${coin.excess.toFixed(1).replace('.', ',')} puan)` : ''),
              `Tepe: ${yuzde(coin.peakChange)}  ·  tepeden: ${yuzde(coin.fromPeak)}` +
                (gv !== null && gv >= 0.05 ? `  ·  kazançtan geri verilen: %${Math.round(gv * 100)}` : '') +
                (coin.peakComplete ? '' : '  (geçmiş hesaplanıyor)'),
              `Son 15 dk: ${coin.mom15 === null ? 'veri birikiyor' : yuzde(coin.mom15)}`,
              `24s hacim: ${hacimMetni(coin.volume)}`,
              `Fiyat: ${fiyat(coin.openPrice)} → ${fiyat(coin.usd)}`
            ];
            if (btc !== null && btc !== undefined) satirlar.push(`BTC: ${yuzde(btc)}`);
            return satirlar;
          }
        }
      }
    },
    scales: {
      x: {
        type: 'category',
        grid: { display: false },
        ticks: { display: false }
      },
      y: {
        grid: { display: false },
        beginAtZero: true
      }
    }
  }
});

// Son yanıta ve filtrelere göre grafiği çizer (sunucuya gitmez)
function grafigiCiz() {
  if (!sonYanit) return;
  let coins = sonYanit.coins.slice();

  // 1. Yalnızca pozitif değerler
  if (filterSettings.showPositiveOnly) {
    coins = coins.filter(coin => coin.change >= 0);
  }

  // 2. Sıralama: sunucu değişime göre sıralı gönderir. Dondurulduysa bilinen
  //    coinler sabit sırada kalır, listeye yeni girenler sona eklenir.
  if (filterSettings.freezeOrder && frozenOrder.length > 0) {
    const sira = new Map(frozenOrder.map((symbol, i) => [symbol, i]));
    const bilinen = coins.filter(c => sira.has(c.symbol)).sort((a, b) => sira.get(a.symbol) - sira.get(b.symbol));
    const yeni = coins.filter(c => !sira.has(c.symbol));
    coins = [...bilinen, ...yeni];
  }
  if (filterSettings.freezeOrder) {
    frozenOrder = coins.map(c => c.symbol);
  }

  // 3. Yalnızca en çok artan 5 coin (mevcut sıra korunur)
  if (filterSettings.showTop5Only) {
    const top5 = new Set([...coins].sort((a, b) => b.change - a.change).slice(0, 5).map(c => c.symbol));
    coins = coins.filter(c => top5.has(c.symbol));
  }

  const btc = sonYanit.btcChange;
  const [asil, tepe, btcCizgi] = mainChart.data.datasets;

  // Etiketler eksende gizli; benzersiz olmaları kategori ekseninin doğru kurulması için
  mainChart.data.labels = coins.map(c => c.symbol);
  asil.data = coins.map(c => c.change);
  asil.backgroundColor = coins.map(c => renkSec(c).bg);
  asil.borderColor = coins.map(c => renkSec(c).border);
  asil.customData = coins;
  tepe.data = coins.map(c => Math.max(c.peakChange, 0));
  btcCizgi.data = btc === null ? [] : coins.map(() => btc);
  mainChart.update();

  const bosMesaj = document.getElementById('emptyMessage');
  if (bosMesaj) {
    if (sonYanit.referenceCount === 0) {
      bosMesaj.textContent = "Referans fiyat yok. \"Güncel Fiyatları Kullan\" düğmesine basın.";
      bosMesaj.style.display = 'block';
    } else if (coins.length === 0) {
      bosMesaj.textContent = 'Seçilen filtrelere uyan coin yok.';
      bosMesaj.style.display = 'block';
    } else {
      bosMesaj.style.display = 'none';
    }
  }
}

// Durum çubuğu: BTC ve verinin tazeliği. Saniyede bir yenilenir.
function durumuGuncelle() {
  const btcEl = document.getElementById('btcStatus');
  const veriEl = document.getElementById('dataStatus');
  if (!btcEl || !veriEl) return;

  if (baglantiHatasi) {
    veriEl.className = 'data-status durum-kirmizi';
    veriEl.textContent = 'Sunucuya ulaşılamıyor';
    return;
  }
  if (!sonYanit) {
    veriEl.className = 'data-status';
    veriEl.textContent = 'Veri bekleniyor…';
    return;
  }

  const btc = sonYanit.btcChange;
  btcEl.innerHTML = `BTC: <b class="${btc === null ? '' : btc >= 0 ? 'pozitif' : 'negatif'}">${yuzde(btc)}</b>`;

  // Yaş, sunucu saatine göre hesaplanır; tarayıcı saati yanlış olabilir
  const yas = sonYanit.updatedAt
    ? Math.max(0, Math.round((sonYanit.serverTime - sonYanit.updatedAt + (Date.now() - sonYanitAlinma)) / 1000))
    : null;
  const yasMetni = yas === null ? '' : ` · ${yas} sn önce`;

  if (sonYanit.stale || yas === null || yas > 30) {
    veriEl.className = 'data-status durum-kirmizi';
    veriEl.textContent = `Veri akışı durdu${yasMetni} — grafik güncel değil`;
  } else if (sonYanit.source === 'akis') {
    veriEl.className = 'data-status durum-yesil';
    veriEl.textContent = `Canlı${yasMetni}`;
  } else if (sonYanit.source === 'rest') {
    veriEl.className = 'data-status durum-sari';
    veriEl.textContent = `Yedek bağlantı (REST)${yasMetni}`;
  } else {
    // Başlangıç verisi var ama canlı akıştan henüz mesaj gelmedi
    veriEl.className = 'data-status durum-sari';
    veriEl.textContent = `Canlı akış bekleniyor${yasMetni}`;
  }
}

async function updateMainChart() {
  try {
    const params = new URLSearchParams({ minVolume: String(filterSettings.minVolume), limit: '50' });
    const ek = alarmSembolleri();
    if (ek.length) params.set('ek', ek.join(','));
    sonYanit = await fetchJson(`/api/livecoins?${params}`);
    sonYanitAlinma = Date.now();
    baglantiHatasi = false;
    grafigiCiz();
    alarmlariKontrolEt(sonYanit.coins, sonYanit.extras || []);
  } catch (error) {
    baglantiHatasi = true;
    console.error("Error updating main chart:", error);
  }
  durumuGuncelle();
}

// Fiyat güncelleme butonunu ayarla
function setupUpdatePricesButton() {
  const updateBtn = document.getElementById('updatePrices');
  if (!updateBtn) return;

  updateBtn.addEventListener('click', async () => {
    const isConfirmed = confirm('Referans fiyatlar şu anki fiyatlarla değiştirilecek (tüm kullanıcılar için). Emin misiniz?');
    if (!isConfirmed) return;

    try {
      updateBtn.disabled = true;
      updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Güncelleniyor...';

      const result = await fetchJson('/api/update-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      console.log('Fiyat güncelleme isteği gönderildi:', result);
      currentTime = result.time;
      // Bildirimler ve buton durumu socket.io olayları ile güncellenecek
    } catch (error) {
      console.error('Fiyat güncelleme hatası:', error);
      showNotification(
        'Fiyat güncelleme hatası',
        `${error.message}<br>Lütfen daha sonra tekrar deneyin.`,
        true,
        'error'
      );
      setTimeout(hideNotification, 3000);
      updateBtn.disabled = false;
      updateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Güncel Fiyatları Kullan';
    }
  });
}

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
  setupThemeToggle();
  setupFilterToggles();
  setupUpdatePricesButton();
  alarmlariYukle();
  alarmlariKur();
  sembolleriYukle();
  // Tarayıcı sesi ancak kullanıcı etkileşiminden sonra çalabiliyor
  document.addEventListener('pointerdown', sesiHazirla, { once: true });
  updateChartColors();
  updatePageTitle();
  updateMainChart();
  setInterval(updateMainChart, GUNCELLEME_ARALIGI_MS);
  setInterval(durumuGuncelle, 1000);
});
