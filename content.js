// DuoParty Content Script: Video Sync + WebRTC Voice Chat + Injected UI

(() => {
  // Prevent duplicate injections
  if (window.duoPartyInitialized) return;
  window.duoPartyInitialized = true;

  console.log('[DuoParty] Yüklendi ve başlatılıyor...');

  // Configuration & State
  let config = {
    serverUrl: 'ws://localhost:3000',
    roomId: 'duo-love-room',
    userName: 'Ben'
  };

  let socket = null;
  let isConnected = false;
  let videoElement = null;
  let isExternalAction = false;
  let pingInterval = null;

  // WebRTC & Audio State
  let peerConnection = null;
  let localStream = null;
  let remoteAudioElement = null;
  let isMicActive = false;
  let isMuted = false;
  let audioContext = null;
  let analyser = null;
  let micCheckInterval = null;
  let partnerSpeakingTimeout = null;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  // UI Elements
  let widgetContainer = null;

  // 1. Load Settings from Chrome Storage
  function loadSettings(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['serverUrl', 'roomId', 'userName'], (items) => {
        if (items.serverUrl) config.serverUrl = items.serverUrl;
        if (items.roomId) config.roomId = items.roomId;
        if (items.userName) config.userName = items.userName;
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  // 2. Initialize UI (Floating Widget)
  function initUI() {
    if (document.getElementById('duoparty-widget-container')) return;

    widgetContainer = document.createElement('div');
    widgetContainer.id = 'duoparty-widget-container';
    widgetContainer.innerHTML = `
      <div class="duoparty-widget" id="duoparty-widget">
        <div class="duoparty-header" id="duoparty-header">
          <div class="duoparty-title-area">
            <span class="duoparty-logo">🍿</span>
            <span class="duoparty-title">DuoParty</span>
            <span class="duoparty-badge disconnected" id="duoparty-status">
              <span class="dot"></span><span id="duoparty-status-text">Bağlantı Yok</span>
            </span>
          </div>
          <div class="duoparty-actions">
            <button class="duoparty-icon-btn" id="duoparty-min-btn" title="Küçült/Büyüt">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>

        <div class="duoparty-body" id="duoparty-body">
          <div class="duoparty-users">
            <!-- Self -->
            <div class="duoparty-user-card" id="duoparty-card-self">
              <div class="duoparty-avatar-wrap">
                <div class="duoparty-speaking-ring" id="duoparty-ring-self"></div>
                <span id="duoparty-avatar-self">S</span>
              </div>
              <span class="duoparty-user-name" id="duoparty-name-self">Sen</span>
              <span class="duoparty-user-status" id="duoparty-mic-status-self">🎤 Kapalı</span>
            </div>

            <!-- Partner -->
            <div class="duoparty-user-card partner" id="duoparty-card-partner">
              <div class="duoparty-avatar-wrap">
                <div class="duoparty-speaking-ring" id="duoparty-ring-partner"></div>
                <span id="duoparty-avatar-partner">❤️</span>
              </div>
              <span class="duoparty-user-name" id="duoparty-name-partner">Partner Bekleniyor</span>
              <span class="duoparty-user-status" id="duoparty-mic-status-partner">Bekleniyor...</span>
            </div>
          </div>

          <div class="duoparty-banner" id="duoparty-banner">
            Oda: <strong style="margin-left: 4px; color: #fff;">${config.roomId}</strong>
          </div>

          <div class="duoparty-controls">
            <button class="duoparty-btn duoparty-btn-mic muted" id="duoparty-mic-btn">
              <span id="duoparty-mic-icon">🎙️</span>
              <span id="duoparty-mic-btn-text">Sesi Başlat</span>
            </button>
            <button class="duoparty-btn duoparty-btn-sync" id="duoparty-sync-btn" title="Videoyu Eşitle">
              🔄 Eşitle
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(widgetContainer);

    // Setup Hidden Remote Audio
    remoteAudioElement = document.createElement('audio');
    remoteAudioElement.id = 'duoparty-remote-audio';
    remoteAudioElement.autoplay = true;
    document.body.appendChild(remoteAudioElement);

    // Attach Widget Event Listeners
    setupWidgetEvents();
    updateUserLabels();
  }

  function setupWidgetEvents() {
    // Draggable header
    const header = document.getElementById('duoparty-header');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = widgetContainer.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      widgetContainer.style.right = 'auto';
      widgetContainer.style.left = `${initialLeft}px`;
      widgetContainer.style.top = `${initialTop}px`;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      widgetContainer.style.left = `${Math.max(10, Math.min(window.innerWidth - 300, initialLeft + dx))}px`;
      widgetContainer.style.top = `${Math.max(10, Math.min(window.innerHeight - 100, initialTop + dy))}px`;
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    // Minimize toggle
    const minBtn = document.getElementById('duoparty-min-btn');
    const widget = document.getElementById('duoparty-widget');
    minBtn.addEventListener('click', () => {
      widget.classList.toggle('minimized');
    });

    // Mic button
    const micBtn = document.getElementById('duoparty-mic-btn');
    micBtn.addEventListener('click', () => {
      if (!isMicActive) {
        startVoiceChat();
      } else {
        toggleMute();
      }
    });

    // Manual Sync button
    const syncBtn = document.getElementById('duoparty-sync-btn');
    syncBtn.addEventListener('click', () => {
      if (videoElement && isConnected) {
        sendVideoSync(videoElement.paused ? 'PAUSE' : 'PLAY', videoElement.currentTime);
        showBanner('🔄 Eşitleme sinyali gönderildi');
      }
    });
  }

  function updateUserLabels() {
    const nameSelf = document.getElementById('duoparty-name-self');
    const avatarSelf = document.getElementById('duoparty-avatar-self');
    if (nameSelf) nameSelf.textContent = config.userName || 'Sen';
    if (avatarSelf) avatarSelf.textContent = (config.userName || 'S').charAt(0).toUpperCase();
  }

  function setStatus(state, text) {
    const badge = document.getElementById('duoparty-status');
    const badgeText = document.getElementById('duoparty-status-text');
    if (!badge || !badgeText) return;

    badge.className = `duoparty-badge ${state}`;
    badgeText.textContent = text;
  }

  function showBanner(msg, isHighlight = true) {
    const banner = document.getElementById('duoparty-banner');
    if (!banner) return;
    banner.textContent = msg;
    if (isHighlight) {
      banner.classList.add('highlight');
      setTimeout(() => banner.classList.remove('highlight'), 2500);
    }
  }

  // 3. WebSocket Connection & Handling
  function connectSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus('connecting', 'Bağlanıyor...');

    try {
      socket = new WebSocket(config.serverUrl);

      socket.onopen = () => {
        console.log('[DuoParty] Sunucuya bağlandı.');
        isConnected = true;
        setStatus('connected', 'Bağlandı');
        showBanner('🎉 Odaya bağlanıldı');

        // Join room
        socket.send(JSON.stringify({
          type: 'JOIN',
          roomId: config.roomId,
          userName: config.userName
        }));

        // Heartbeat
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'PING' }));
          }
        }, 20000);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerMessage(data);
        } catch (err) {
          console.error('[DuoParty] Mesaj parse hatası:', err);
        }
      };

      socket.onclose = () => {
        console.log('[DuoParty] Bağlantı kapandı, 4sn içinde tekrar denenecek...');
        isConnected = false;
        setStatus('disconnected', 'Bağlantı Kesildi');
        if (pingInterval) clearInterval(pingInterval);
        setTimeout(connectSocket, 4000);
      };

      socket.onerror = (err) => {
        console.warn('[DuoParty] WebSocket hatası:', err);
        setStatus('disconnected', 'Sunucu Hatası');
      };
    } catch (e) {
      console.error('[DuoParty] WebSocket başlatılamadı:', e);
      setTimeout(connectSocket, 5000);
    }
  }

  function handleServerMessage(data) {
    switch (data.type) {
      case 'JOINED': {
        if (data.peersCount > 1) {
          showBanner('❤️ Partner odada!');
        }
        break;
      }

      case 'PEER_JOINED': {
        const partnerNameEl = document.getElementById('duoparty-name-partner');
        const partnerStatusEl = document.getElementById('duoparty-mic-status-partner');
        if (partnerNameEl) partnerNameEl.textContent = data.userName;
        if (partnerStatusEl) partnerStatusEl.textContent = 'Bağlandı';
        showBanner(`❤️ ${data.userName} katıldı!`);
        break;
      }

      case 'PEER_LEFT': {
        const partnerNameEl = document.getElementById('duoparty-name-partner');
        const partnerStatusEl = document.getElementById('duoparty-mic-status-partner');
        if (partnerNameEl) partnerNameEl.textContent = 'Ayrıldı';
        if (partnerStatusEl) partnerStatusEl.textContent = 'Çevrimdışı';
        showBanner(`👋 ${data.userName} ayrıldı`);
        cleanupPeerConnection();
        break;
      }

      case 'SYNC': {
        handleRemoteSync(data);
        break;
      }

      case 'INITIATE_WEBRTC': {
        // Someone joined after us, let's create the offer if we have or haven't started mic
        initiateWebRTCConnection(true);
        break;
      }

      case 'SIGNAL': {
        handleWebRTCSignal(data.signal);
        break;
      }

      case 'VOICE_STATUS': {
        handleVoiceStatus(data);
        break;
      }

      default:
        break;
    }
  }

  // 4. Video Synchronization Logic
  function getVideoElement() {
    // YouTube or Netflix video tag
    return document.querySelector('video');
  }

  function setupVideoListeners() {
    const video = getVideoElement();
    if (!video) {
      setTimeout(setupVideoListeners, 1000);
      return;
    }

    if (videoElement === video) return; // Already attached
    videoElement = video;

    console.log('[DuoParty] Video oynatıcı yakalandı!', video);

    video.addEventListener('play', () => {
      if (isExternalAction || !isConnected) return;
      console.log('[DuoParty] Yerel OYNAT tetiklendi:', video.currentTime);
      sendVideoSync('PLAY', video.currentTime);
    });

    video.addEventListener('pause', () => {
      if (isExternalAction || !isConnected) return;
      console.log('[DuoParty] Yerel DURDUR tetiklendi:', video.currentTime);
      sendVideoSync('PAUSE', video.currentTime);
    });

    video.addEventListener('seeked', () => {
      if (isExternalAction || !isConnected) return;
      console.log('[DuoParty] Yerel SARMA (SEEK) tetiklendi:', video.currentTime);
      sendVideoSync('SEEK', video.currentTime);
    });
  }

  function sendVideoSync(action, time) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'SYNC',
      action,
      time
    }));
  }

  function handleRemoteSync(data) {
    const video = getVideoElement();
    if (!video) return;

    isExternalAction = true;

    // Time synchronization: if drift is > 0.5s, seek
    if (Math.abs(video.currentTime - data.time) > 0.5) {
      video.currentTime = data.time;
    }

    if (data.action === 'PLAY') {
      showBanner(`▶️ ${data.sender || 'Partner'} başlattı`);
      video.play().catch(e => console.warn('[DuoParty] Play hatası:', e));
    } else if (data.action === 'PAUSE') {
      showBanner(`⏸️ ${data.sender || 'Partner'} durdurdu`);
      video.pause();
    } else if (data.action === 'SEEK') {
      showBanner(`⏩ ${data.sender || 'Partner'} sardı (${Math.floor(data.time)}s)`);
    }

    setTimeout(() => {
      isExternalAction = false;
    }, 500);
  }

  // 5. WebRTC Voice Chat Engine
  async function startVoiceChat() {
    try {
      showBanner('🎤 Mikrofon izni isteniyor...');
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      isMicActive = true;
      isMuted = false;

      // Update Mic Button UI
      const micBtn = document.getElementById('duoparty-mic-btn');
      const micBtnText = document.getElementById('duoparty-mic-btn-text');
      const micStatusSelf = document.getElementById('duoparty-mic-status-self');
      if (micBtn) micBtn.classList.remove('muted');
      if (micBtnText) micBtnText.textContent = 'Mikrofon Açık';
      if (micStatusSelf) micStatusSelf.textContent = '🎤 Açık';

      // Setup local audio level meter
      setupAudioAnalyzer(localStream);

      // Create WebRTC Peer Connection & send offer
      initiateWebRTCConnection(true);

      showBanner('🎙️ Sesli sohbet başlatıldı!');
    } catch (err) {
      console.error('[DuoParty] Mikrofon hatası:', err);
      showBanner('❌ Mikrofon açılamadı! İzin veriniz.');
    }
  }

  function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !isMuted;
    });

    const micBtn = document.getElementById('duoparty-mic-btn');
    const micBtnText = document.getElementById('duoparty-mic-btn-text');
    const micStatusSelf = document.getElementById('duoparty-mic-status-self');

    if (isMuted) {
      if (micBtn) micBtn.classList.add('muted');
      if (micBtnText) micBtnText.textContent = 'Mikrofon Susturuldu';
      if (micStatusSelf) micStatusSelf.textContent = '🔇 Susturuldu';
    } else {
      if (micBtn) micBtn.classList.remove('muted');
      if (micBtnText) micBtnText.textContent = 'Mikrofon Açık';
      if (micStatusSelf) micStatusSelf.textContent = '🎤 Açık';
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'VOICE_STATUS',
        isMuted: isMuted,
        isSpeaking: false
      }));
    }
  }

  function initiateWebRTCConnection(isInitiator) {
    if (!peerConnection) {
      peerConnection = new RTCPeerConnection(rtcConfig);

      // Add local audio tracks if stream exists
      if (localStream) {
        localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStream);
        });
      }

      // Handle incoming remote audio track
      peerConnection.ontrack = (event) => {
        console.log('[DuoParty] Karşı tarafın ses akışı alındı!');
        if (remoteAudioElement && event.streams[0]) {
          remoteAudioElement.srcObject = event.streams[0];
          remoteAudioElement.play().catch(e => console.warn('Audio play hatası:', e));
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'SIGNAL',
            signal: { candidate: event.candidate }
          }));
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log('[DuoParty] WebRTC Bağlantı Durumu:', peerConnection.connectionState);
      };
    }

    if (isInitiator && localStream) {
      peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
          socket.send(JSON.stringify({
            type: 'SIGNAL',
            signal: { offer: peerConnection.localDescription }
          }));
        })
        .catch(err => console.error('[DuoParty] Offer hatası:', err));
    }
  }

  async function handleWebRTCSignal(signal) {
    if (!peerConnection) {
      initiateWebRTCConnection(false);
    }

    try {
      if (signal.offer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'SIGNAL',
            signal: { answer: peerConnection.localDescription }
          }));
        }
      } else if (signal.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer));
      } else if (signal.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (e) {
      console.error('[DuoParty] Sinyalleşme işleme hatası:', e);
    }
  }

  function setupAudioAnalyzer(stream) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let wasSpeaking = false;

      if (micCheckInterval) clearInterval(micCheckInterval);
      micCheckInterval = setInterval(() => {
        if (!isMicActive || isMuted) {
          setSpeakingRing('self', false);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avgVolume = sum / bufferLength;
        const isSpeaking = avgVolume > 18; // Threshold

        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          setSpeakingRing('self', isSpeaking);
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: 'VOICE_STATUS',
              isMuted: isMuted,
              isSpeaking: isSpeaking
            }));
          }
        }
      }, 150);
    } catch (e) {
      console.warn('[DuoParty] Audio analyzer hatası:', e);
    }
  }

  function handleVoiceStatus(data) {
    const partnerCard = document.getElementById('duoparty-card-partner');
    const partnerStatus = document.getElementById('duoparty-mic-status-partner');
    const partnerName = document.getElementById('duoparty-name-partner');

    if (data.userName && partnerName) partnerName.textContent = data.userName;

    if (data.isMuted) {
      if (partnerStatus) partnerStatus.textContent = '🔇 Susturuldu';
      setSpeakingRing('partner', false);
    } else {
      if (partnerStatus) partnerStatus.textContent = '🎤 Açık';
      setSpeakingRing('partner', data.isSpeaking);
    }
  }

  function setSpeakingRing(target, isSpeaking) {
    const ring = document.getElementById(`duoparty-ring-${target}`);
    const card = document.getElementById(`duoparty-card-${target}`);
    if (ring && card) {
      if (isSpeaking) {
        card.classList.add('speaking');
      } else {
        card.classList.remove('speaking');
      }
    }
  }

  function cleanupPeerConnection() {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  }

  // 6. SPA Navigation Observers (YouTube & Netflix support)
  function setupNavigationObservers() {
    // YouTube SPA event
    window.addEventListener('yt-navigate-finish', () => {
      console.log('[DuoParty] YouTube sayfa geçişi algılandı.');
      setupVideoListeners();
    });

    // General MutationObserver for dynamic video elements
    const observer = new MutationObserver(() => {
      if (!videoElement || !document.contains(videoElement)) {
        setupVideoListeners();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 7. Listen for settings updates from Popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'SETTINGS_UPDATED') {
        loadSettings(() => {
          updateUserLabels();
          showBanner(`⚙️ Ayarlar güncellendi (Oda: ${config.roomId})`);
          if (socket) {
            socket.close();
          }
          connectSocket();
        });
        sendResponse({ success: true });
      }
    });
  }

  // 8. Start everything
  loadSettings(() => {
    initUI();
    setupVideoListeners();
    setupNavigationObservers();
    connectSocket();
  });
})();
