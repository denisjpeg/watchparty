document.addEventListener('DOMContentLoaded', () => {
  const userNameInput = document.getElementById('userName');
  const roomIdInput = document.getElementById('roomId');
  const serverUrlInput = document.getElementById('serverUrl');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('statusMsg');

  // Load existing settings
  chrome.storage.sync.get(['userName', 'roomId', 'serverUrl'], (items) => {
    userNameInput.value = items.userName || 'Deniz';
    roomIdInput.value = items.roomId || 'bizim-oda';
    serverUrlInput.value = items.serverUrl || 'ws://localhost:3000';
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const userName = userNameInput.value.trim() || 'Kullanıcı';
    const roomId = roomIdInput.value.trim() || 'bizim-oda';
    let serverUrl = serverUrlInput.value.trim() || 'ws://localhost:3000';

    // Auto fix http/https to ws/wss if entered by user
    if (serverUrl.startsWith('http://')) {
      serverUrl = serverUrl.replace('http://', 'ws://');
    } else if (serverUrl.startsWith('https://')) {
      serverUrl = serverUrl.replace('https://', 'wss://');
    } else if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
      serverUrl = 'ws://' + serverUrl;
    }

    chrome.storage.sync.set({ userName, roomId, serverUrl }, () => {
      statusMsg.style.display = 'block';
      setTimeout(() => {
        statusMsg.style.display = 'none';
      }, 2500);

      // Notify active YouTube / Netflix tabs
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'SETTINGS_UPDATED' }).catch(() => {
            // Tab might not be a YouTube/Netflix tab, ignore
          });
        }
      });
    });
  });
});
