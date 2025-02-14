// public/coinstats.js

// Kaynak: Chart.js datalabels plugin'i
Chart.register(ChartDataLabels);

let currentSource = "coincap"; // Varsayılan olarak CoinCap seçili
let socket = null;
let liveCoins = []; // /api/livecoins'den alınan coin verileri

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
              `Kapanış Fiyatı: $${coin.prevClose.toFixed(6)}`,
              `Güncel Fiyat: $${coin.usd.toFixed(6)}`,
              `Değişim: ${coin.change.toFixed(2)}%`,
              `Kapanış Zamanı: ${new Date(coin.closeTime).toLocaleString()}`
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

async function updateMainChart() {
  try {
    const response = await fetch('/api/livecoins');
    const coins = await response.json();
    // Azalan sırada sıralama (endpoint zaten sıralı olsa bile)
    coins.sort((a, b) => b.change - a.change);
    const labels = [];
    const dataArray = [];
    const bgColors = [];
    const borderColors = [];
    
    coins.forEach(coin => {
      // Mum altında hiçbir etiket göstermiyoruz
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
    // Tooltip'te kullanılmak üzere tüm coin verilerini sakla
    mainChart.data.datasets[0].customData = coins;
    mainChart.update();
  } catch (error) {
    console.error("Error updating main chart:", error);
  }
}
setInterval(updateMainChart, 5000);
updateMainChart();
