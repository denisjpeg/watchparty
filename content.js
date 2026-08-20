// content.js
const socket = new WebSocket('wss://senin-sunucun.onrender.com');

// Netflix player video etiketini yakalama
function getVideoElement() {
  return document.querySelector('video');
}

let isExternalEvent = false;

// 1. Kendi tarayıcındaki hareketleri sunucuya bildir
function attachListeners() {
  const video = getVideoElement();
  if (!video) return setTimeout(attachListeners, 1000);

  video.addEventListener('play', () => {
    if (isExternalEvent) return;
    socket.send(JSON.stringify({ type: 'PLAY', time: video.currentTime }));
  });

  video.addEventListener('pause', () => {
    if (isExternalEvent) return;
    socket.send(JSON.stringify({ type: 'PAUSE', time: video.currentTime }));
  });

  video.addEventListener('seeked', () => {
    if (isExternalEvent) return;
    socket.send(JSON.stringify({ type: 'SEEK', time: video.currentTime }));
  });
}

// 2. Karşı taraftan gelen emirleri uygula
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  const video = getVideoElement();
  if (!video) return;

  isExternalEvent = true; // Kendi listener'ımızın sonsuz döngüye girmesini engelle

  // Zaman farkı 0.5 saniyeden fazlaysa senkronize et
  if (Math.abs(video.currentTime - data.time) > 0.5) {
    video.currentTime = data.time;
  }

  if (data.type === 'PLAY') {
    video.play();
  } else if (data.type === 'PAUSE') {
    video.pause();
  }

  setTimeout(() => { isExternalEvent = false; }, 300);
};

attachListeners();