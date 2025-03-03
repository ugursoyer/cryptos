// public/coinstats.js

// Kaynak: Chart.js datalabels plugin'i
Chart.register(ChartDataLabels);

let currentSource = "coincap"; // Varsayılan olarak CoinCap seçili
let liveCoins = []; // /api/livecoins'den alınan coin verileri
let currentDate = ''; // Güncel tarih bilgisi
let top50Coins = []; // En iyi 50 coinin listesi

// Socket.io bağlantısı
const socket = io();

// Tarih güncellendiğinde sayfayı yenile
socket.on('dateUpdated', (data) => {
  console.log('Yeni tarih alındı:', data.date);
  // Sayfayı yenile
  window.location.reload();
});

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

// Sayfa başlığını güncelleyen fonksiyon
async function updatePageTitle() {
  try {
    const response = await fetch('/api/currentdate');
    const data = await response.json();
    currentDate = data.date;
    
    // Tarihi dd.MM.yyyy formatına dönüştür
    const dateParts = currentDate.split('-');
    const formattedDate = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
    
    // Başlık elementini güncelle
    const titleElement = document.getElementById('pageTitle');
    if (titleElement) {
      titleElement.textContent = `Günün En Çok Yükselen 50 Coini (${formattedDate})`;
    } else {
      // Eğer element yoksa oluştur
      const header = document.createElement('h1');
      header.id = 'pageTitle';
      header.textContent = `Günün En Çok Yükselen 50 Coini (${formattedDate})`;
      header.style.textAlign = 'center';
      header.style.margin = '20px 0';
      
      // Sayfanın başına ekle
      const container = document.querySelector('.container');
      if (container) {
        container.insertBefore(header, container.firstChild);
      } else {
        document.body.insertBefore(header, document.body.firstChild);
      }
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
    const updatedTop50 = top50Coins.map(topCoin => {
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
    
    // Değişim oranına göre sırala
    updatedTop50.sort((a, b) => b.change - a.change);
    
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
  } catch (error) {
    console.error("Error updating main chart:", error);
  }
}

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
  updatePageTitle();
  setupThemeToggle();
  updateChartColors();
  loadInitialTop50(); // İlk 50 coini yükle
});

// 5 saniyede bir güncelle
setInterval(updateMainChart, 5000);
