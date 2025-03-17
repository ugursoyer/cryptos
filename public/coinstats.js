// public/coinstats.js

// Kaynak: Chart.js datalabels plugin'i
Chart.register(ChartDataLabels);

let currentSource = "coincap"; // Varsayılan olarak CoinCap seçili
let liveCoins = []; // /api/livecoins'den alınan coin verileri
let currentDate = ''; // Güncel tarih bilgisi
let currentTime = ''; // Güncel saat bilgisi
let top50Coins = []; // En iyi 50 coinin listesi
let originalOrder = []; // Sıralamayı dondurmak için orijinal sıralama
let filterSettings = {
  showPositiveOnly: false,
  freezeOrder: false,
  showTop5Only: false
};

// Socket.io bağlantısı
const socket = io();

// Tarih güncellendiğinde sayfayı yenile
socket.on('dateUpdated', (data) => {
  console.log('Yeni tarih alındı:', data);
  
  // Eğer pageTitle bilgisi varsa, başlığı güncelle
  if (data.pageTitle) {
    const titleElement = document.getElementById('pageTitle');
    if (titleElement) {
      titleElement.textContent = data.pageTitle;
    }
    // Sayfayı yenileme - başlık zaten güncellendi
    // Sadece verileri yenile
    loadInitialTop50();
  } else {
    // Eski davranış - sayfayı tamamen yenile
    window.location.reload();
  }
});

// Fiyat güncelleme işlemi başladığında
socket.on('priceUpdateStarted', (data) => {
  console.log('Fiyat güncelleme başladı:', data);
  
  // Güncelleme butonunu devre dışı bırak
  const updateBtn = document.getElementById('updatePrices');
  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Güncelleniyor...';
  }
  
  showNotification(
    'Fiyat güncelleme işlemi başladı',
    `Toplam ${data.totalCount} coin için fiyat güncellemesi yapılacak.<br>${data.estimatedTime}`,
    false,
    'spinner'
  );
});

// Fiyat güncelleme ilerleme bilgisi
socket.on('priceUpdateProgress', (data) => {
  console.log('Fiyat güncelleme ilerleme:', data);
  
  // İlerleme yüzdesini hesapla
  const percent = Math.round((data.processedCount / data.totalCount) * 100);
  const remainingCoins = data.totalCount - data.processedCount;
  
  // Hata oranı
  const errorCount = data.errorCount || 0;
  
  // Tahmini kalan süre
  const estimatedRemainingTime = data.estimatedRemainingTime || 
    (remainingCoins > 0 ? `Yaklaşık ${Math.ceil(remainingCoins / 100)} dakika kaldı` : 'Tamamlanmak üzere');
  
  showNotification(
    'Fiyat güncelleme işlemi devam ediyor',
    `${data.processedCount}/${data.totalCount} coin işlendi (${percent}%)<br>
    Başarılı: ${data.successCount} coin<br>
    ${errorCount > 0 ? `Hata: ${errorCount} coin<br>` : ''}
    Kalan: ${remainingCoins} coin<br>
    ${estimatedRemainingTime}`,
    false,
    'spinner'
  );
});

// Fiyat güncelleme işlemi tamamlandığında
socket.on('priceUpdateCompleted', (data) => {
  console.log('Fiyat güncelleme tamamlandı:', data);
  
  // Hata sayısı
  const errorCount = data.errorCount || 0;
  const errorRate = data.totalCount > 0 ? ((errorCount / data.totalCount) * 100).toFixed(1) : 0;
  
  showNotification(
    'Fiyat güncelleme işlemi tamamlandı',
    `${data.successCount}/${data.totalCount} coin başarıyla güncellendi (${((data.successCount / data.totalCount) * 100).toFixed(1)}%).<br>
    ${errorCount > 0 ? `${errorCount} coin güncellenemedi (${errorRate}%).<br>` : ''}
    Tarih: ${data.date}<br>
    Saat: ${data.time}`,
    false,
    'check'
  );
  
  // 2 saniye sonra bildirimi kapat ve sayfayı yenile
  setTimeout(() => {
    hideNotification();
    window.location.reload(); // Sayfayı yenile
  }, 2000);
  
  // Güncelleme butonunu eski haline getir
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
  
  // Güncelleme butonunu eski haline getir
  const updateBtn = document.getElementById('updatePrices');
  if (updateBtn) {
    updateBtn.disabled = false;
    updateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Güncel Fiyatları Kullan';
  }
  
  // 5 saniye sonra bildirimi kapat
  setTimeout(hideNotification, 5000);
});

// Bildirim panelini göster
function showNotification(title, details, isError = false, iconType = 'spinner') {
  const panel = document.getElementById('notification-panel');
  const messageEl = panel.querySelector('.notification-message');
  const iconEl = panel.querySelector('.notification-icon i');
  
  // Detay elementi var mı kontrol et, yoksa oluştur
  let detailsEl = panel.querySelector('.notification-details');
  if (!detailsEl) {
    detailsEl = document.createElement('div');
    detailsEl.className = 'notification-details';
    panel.querySelector('.notification-content').appendChild(detailsEl);
  }
  
  // İçerikleri ayarla
  messageEl.innerHTML = title;
  detailsEl.innerHTML = details;
  
  // İkon tipini ayarla
  if (isError) {
    iconEl.className = 'fas fa-exclamation-triangle';
  } else {
    if (iconType === 'spinner') {
      iconEl.className = 'fas fa-spinner fa-spin';
    } else if (iconType === 'check') {
      iconEl.className = 'fas fa-check-circle';
    } else {
      iconEl.className = 'fas fa-info-circle';
    }
  }
  
  // Paneli göster
  panel.style.display = 'flex';
  
  // Sayfa boyutunu değiştirmemesi için body'ye overflow: hidden ekle
  document.body.style.overflow = 'hidden';
}

// Bildirim panelini gizle
function hideNotification() {
  const panel = document.getElementById('notification-panel');
  panel.style.display = 'none';
  
  // Body'nin overflow özelliğini geri al
  document.body.style.overflow = '';
}

// Tema değiştirme işlevselliği
function setupThemeToggle() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeIcon = themeToggleBtn.querySelector('i');
  
  // Sayfa yüklendiğinde localStorage'dan tema tercihini al
  const savedTheme = localStorage.getItem('theme');
  
  // Eğer kaydedilmiş bir tema varsa uygula
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    themeIcon.classList.remove('fa-moon');
    themeIcon.classList.add('fa-sun');
  }
  
  // Tema değiştirme düğmesine tıklama olayı ekle
  themeToggleBtn.addEventListener('click', () => {
    // Temayı değiştir
    document.body.classList.toggle('dark-theme');
    
    // İkonu güncelle
    if (document.body.classList.contains('dark-theme')) {
      themeIcon.classList.remove('fa-moon');
      themeIcon.classList.add('fa-sun');
      localStorage.setItem('theme', 'dark');
    } else {
      themeIcon.classList.remove('fa-sun');
      themeIcon.classList.add('fa-moon');
      localStorage.setItem('theme', 'light');
    }
    
    // Grafik renklerini güncelle
    updateChartColors();
  });
}

// Filtre ayarlarını kurma
function setupFilterToggles() {
  // Toggle elementlerini seç
  const showPositiveOnlyToggle = document.getElementById('positiveOnly');
  const freezeOrderToggle = document.getElementById('freezeOrder');
  const showTop5Toggle = document.getElementById('showTop5');
  
  // LocalStorage'dan kaydedilmiş ayarları al
  const savedSettings = JSON.parse(localStorage.getItem('filterSettings')) || {};
  
  // Kaydedilmiş ayarları uygula
  if (savedSettings.showPositiveOnly !== undefined) {
    filterSettings.showPositiveOnly = savedSettings.showPositiveOnly;
    showPositiveOnlyToggle.checked = savedSettings.showPositiveOnly;
  }
  
  if (savedSettings.freezeOrder !== undefined) {
    filterSettings.freezeOrder = savedSettings.freezeOrder;
    freezeOrderToggle.checked = savedSettings.freezeOrder;
  }
  
  if (savedSettings.showTop5Only !== undefined) {
    filterSettings.showTop5Only = savedSettings.showTop5Only;
    showTop5Toggle.checked = savedSettings.showTop5Only;
  }
  
  // Toggle olaylarını ekle
  showPositiveOnlyToggle.addEventListener('change', function() {
    filterSettings.showPositiveOnly = this.checked;
    localStorage.setItem('filterSettings', JSON.stringify(filterSettings));
    updateMainChart();
  });
  
  freezeOrderToggle.addEventListener('change', function() {
    filterSettings.freezeOrder = this.checked;
    
    // Eğer sıralama donduruluyorsa, mevcut sıralamayı kaydet
    if (this.checked && originalOrder.length === 0) {
      originalOrder = [...mainChart.data.datasets[0].customData.map(coin => coin.symbol)];
    }
    
    localStorage.setItem('filterSettings', JSON.stringify(filterSettings));
    updateMainChart();
  });
  
  showTop5Toggle.addEventListener('change', function() {
    filterSettings.showTop5Only = this.checked;
    localStorage.setItem('filterSettings', JSON.stringify(filterSettings));
    updateMainChart();
  });
}

// Grafik renklerini tema değişikliğine göre güncelle
function updateChartColors() {
  const isDarkTheme = document.body.classList.contains('dark-theme');
  
  if (mainChart) {
    // Etiket renklerini güncelle
    mainChart.options.plugins.datalabels.labels.coinName.color = isDarkTheme ? '#f0f0f0' : 'rgb(38, 38, 38)';
    
    // Grafik güncelle
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

// Sayfa başlığını güncelleyen fonksiyon
async function updatePageTitle() {
  try {
    const response = await fetch('/api/currentdate');
    const data = await response.json();
    currentDate = data.date;
    currentTime = data.time || '';
    
    // Tarihi formatla
    const formattedDate = formatDate(currentDate);
    
    // Başlık elementini güncelle
    const titleElement = document.getElementById('pageTitle');
    if (titleElement) {
      let title = `${formattedDate}`;
      
      // Eğer saat bilgisi varsa ekle
      if (currentTime) {
        title += ` ${currentTime}`;
      }
      
      title += `'den İtibaren En Çok Yükselen`;
      
      if (filterSettings.showTop5Only) {
        title += ` 5`;
      } else {
        title += ` 50`;
      }
      
      title += ` Coin`;
      
      if (filterSettings.showPositiveOnly) {
        title += ` - Yalnızca Pozitif Değerler`;
      }
      
      titleElement.textContent = title;
    }
  } catch (error) {
    console.error("Tarih bilgisi alınamadı:", error);
  }
}

// --- Main Chart: Dikey Bar Chart ---
const ctxMain = document.getElementById('barChart').getContext('2d');
var mainChart = new Chart(ctxMain, {
  type: 'bar',
  data: {
    labels: [], // Alt kısımda hiçbir şey görünmesin
    datasets: [{
      label: '% Değişim',
      data: [],
      backgroundColor: [],
      borderColor: [],
      borderWidth: 1,
      // Tooltip için ek veri saklamak amacıyla customData dizisi
      customData: []
    }]
  },
  options: {
    responsive: true,
    layout: {
      padding: {
        bottom: 50  
      }
    },
    plugins: {
      datalabels: {
        // Çoklu etiket yapılandırması
        labels: {
          coinName: {
            anchor: 'start',
            align: 'start',
            rotation: 270, 
            offset: 10, 
            formatter: (value, context) => {
              const coin = context.chart.data.datasets[0].customData[context.dataIndex];
              return coin.symbol.replace("USDT", "");
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
            color: 'rgba(0, 177, 106, 1)',
            font: { family: 'Helvetica, Arial, sans-serif', weight: 'bold', size: 13 }
          }
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const coin = context.chart.data.datasets[0].customData[context.dataIndex];
            const sym = coin.symbol;
            const coinName = sym.replace("USDT", "");
            const pair = "USDT";
            return [
              `${coinName} (${pair})`,
              `Başlangıç Fiyatı: $${coin.openPrice.toFixed(6)}`,
              `Güncel Fiyat: $${coin.usd.toFixed(6)}`,
              `Değişim: ${coin.change.toFixed(2)}%`
            ];
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { display: false },
        title: {
          display: true
          //text: "% Değişim"
        }
      },
      y: {
        grid: { display: false },
        beginAtZero: true
      }
    }
  }
});

// İlk yüklemede en iyi 50 coini al
async function loadInitialTop50() {
  try {
    const response = await fetch('/api/livecoins');
    const coins = await response.json();
    // Azalan sırada sıralama
    coins.sort((a, b) => b.change - a.change);
    // İlk 50 coini al
    top50Coins = coins.slice(0, 50);
    // İlk grafiği çiz
    updateMainChart();
  } catch (error) {
    console.error("Error loading initial top 50:", error);
  }
}

async function updateMainChart() {
  try {
    const response = await fetch('/api/livecoins');
    const allCoins = await response.json();
    
    // Sadece top 50'deki coinlerin güncel verilerini al
    let updatedTop50 = top50Coins.map(topCoin => {
      const currentCoin = allCoins.find(c => c.symbol === topCoin.symbol);
      // Eğer coin bulunamazsa veya undefined ise, güncelleme yapma
      if (!currentCoin) {
        console.log(`${topCoin.symbol} için güncel veri bulunamadı, eski veri kullanılıyor`);
        return topCoin;
      }
      
      // Coin bulundu ama değerleri eksikse, eski veriyi kullan
      if (currentCoin.usd === undefined || currentCoin.change === undefined) {
        console.log(`${topCoin.symbol} için eksik veri, eski veri kullanılıyor`);
        return topCoin;
      }
      
      return currentCoin;
    });
    
    // Filtre ayarlarını uygula
    
    // 1. Yalnızca pozitif değerleri göster
    if (filterSettings.showPositiveOnly) {
      updatedTop50 = updatedTop50.filter(coin => coin.change >= 0);
    }
    
    // 2. Sıralamayı dondur veya değişim oranına göre sırala
    if (filterSettings.freezeOrder && originalOrder.length > 0) {
      // Orijinal sıralamayı kullan
      updatedTop50.sort((a, b) => {
        const indexA = originalOrder.indexOf(a.symbol);
        const indexB = originalOrder.indexOf(b.symbol);
        return indexA - indexB;
      });
    } else {
      // Değişim oranına göre sırala
      updatedTop50.sort((a, b) => b.change - a.change);
      
      // Eğer sıralama dondurulmuş değilse ve orijinal sıralama boşsa, yeni sıralamayı kaydet
      if (!filterSettings.freezeOrder) {
        originalOrder = updatedTop50.map(coin => coin.symbol);
      }
    }
    
    // 3. Yalnızca en çok artan 5 coini göster
    if (filterSettings.showTop5Only) {
      // Önce değişim oranına göre sırala (sıralama dondurulmuş olsa bile)
      const sortedForTop5 = [...updatedTop50].sort((a, b) => b.change - a.change);
      // En çok artan 5 coini al
      const top5Symbols = sortedForTop5.slice(0, 5).map(coin => coin.symbol);
      // Sadece bu 5 coini göster, ancak mevcut sıralamayı koru
      updatedTop50 = updatedTop50.filter(coin => top5Symbols.includes(coin.symbol));
    }
    
    // Veri setini güncelle
    const labels = [];
    const dataArray = [];
    const bgColors = [];
    const borderColors = [];
    
    updatedTop50.forEach(coin => {
      if (!coin || coin.change === undefined) {
        console.error(`Hatalı coin verisi:`, coin);
        return;
      }
      
      labels.push('');
      dataArray.push(coin.change);
      if (coin.change >= 0) {
        bgColors.push('rgba(0, 177, 106, 0.6)');
        borderColors.push('rgba(0, 177, 106, 1)');
      } else {
        bgColors.push('rgba(235, 54, 54, 0.6)');
        borderColors.push('rgba(235, 54, 54, 1)');
      }
    });
    
    mainChart.data.labels = labels;
    mainChart.data.datasets[0].data = dataArray;
    mainChart.data.datasets[0].backgroundColor = bgColors;
    mainChart.data.datasets[0].borderColor = borderColors;
    mainChart.data.datasets[0].customData = updatedTop50;
    mainChart.update();
    
    // Başlık güncelleme
    const titleElement = document.getElementById('pageTitle');
    if (titleElement) {
      // Mevcut başlık metnini al
      const currentTitle = titleElement.textContent;
      
      // Başlıkta "En Çok Yükselen" ifadesini ara
      const titleParts = currentTitle.split("'den İtibaren En Çok Yükselen");
      
      if (titleParts.length > 1) {
        // Başlığın ilk kısmını koru (tarih ve saat)
        let newTitle = titleParts[0] + "'den İtibaren En Çok Yükselen";
        
        // Filtre ayarlarına göre coin sayısını ekle
        if (filterSettings.showTop5Only) {
          newTitle += " 5";
        } else {
          newTitle += " 50";
        }
        
        newTitle += " Coin";
        
        // Pozitif değerler filtresi varsa ekle
        if (filterSettings.showPositiveOnly) {
          newTitle += " - Yalnızca Pozitif Değerler";
        }
        
        titleElement.textContent = newTitle;
      }
    }
    
  } catch (error) {
    console.error("Error updating main chart:", error);
  }
}

// Fiyat güncelleme butonunu ayarla
function setupUpdatePricesButton() {
  const updateBtn = document.getElementById('updatePrices');
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      // Kullanıcıya onay sor
      const isConfirmed = confirm('Fiyatları güncellenecektir. Emin misiniz?');
      
      // Eğer kullanıcı iptal ettiyse işlemi sonlandır
      if (!isConfirmed) {
        return;
      }
      
      try {
        // Butonu devre dışı bırak
        updateBtn.disabled = true;
        updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Güncelleniyor...';
        
        // API'ye istek gönder
        const response = await fetch('/api/update-prices', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error || 'Fiyat güncelleme hatası');
        }
        
        console.log('Fiyat güncelleme isteği gönderildi:', result);
        
        // Güncel saat bilgisini kaydet
        currentTime = result.time;
        
        // Bildirimler ve buton durumu socket.io olayları ile güncellenecek
        
      } catch (error) {
        console.error('Fiyat güncelleme hatası:', error);
        
        // Hata bildirimi göster
        showNotification(
          'Fiyat güncelleme hatası',
          `${error.message}<br>Lütfen daha sonra tekrar deneyin.`,
          true,
          'error'
        );
        
        // 3 saniye sonra bildirimi kapat
        setTimeout(hideNotification, 3000);
        
        // Butonu eski haline getir
        updateBtn.disabled = false;
        updateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Güncel Fiyatları Kullan';
      }
    });
  }
}

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
  updatePageTitle();
  setupThemeToggle();
  setupFilterToggles(); // Filtre toggle'larını kur
  setupUpdatePricesButton(); // Fiyat güncelleme butonunu kur
  updateChartColors();
  loadInitialTop50(); // İlk 50 coini yükle
});

// 5 saniyede bir güncelle
setInterval(updateMainChart, 5000);
