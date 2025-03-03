// public/login.js

// Tema değiştirme işlevselliği
function setupThemeToggle() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  if (!themeToggleBtn) return; // Eğer düğme yoksa işlemi sonlandır
  
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
  });
}

// Sayfa yüklendiğinde tema değiştirme işlevselliğini başlat
document.addEventListener('DOMContentLoaded', () => {
  setupThemeToggle();
}); 