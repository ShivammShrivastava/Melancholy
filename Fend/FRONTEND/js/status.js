/* ═══════════════════════════════════════════════════════════════
   KaamFlow — Online/Offline Status (js/status.js)
   Uses navigator.onLine + event listeners so it reflects
   real airplane-mode toggling during demos.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var _isOnline = navigator.onLine;
  var _callbacks = [];
  var _lastSyncTime = new Date();
  var _hasShownOfflineBanner = false;

  // ─── LISTENERS ───
  window.addEventListener('online', function () {
    _isOnline = true;
    _lastSyncTime = new Date();
    _notifyAll();
    // Mark pending sync items as synced
    var queue = DataStore.getSyncQueue();
    queue.forEach(function (item) {
      if (item.status === 'pending') item.status = 'synced';
    });
    localStorage.setItem('kaamflow_' + DataStore.getActiveDevice() + '_syncQueue', JSON.stringify(queue));
    _showReconnectToast();
  });

  window.addEventListener('offline', function () {
    _isOnline = false;
    _notifyAll();
    _showOfflineBanner();
  });

  function _notifyAll() {
    _callbacks.forEach(function (cb) { cb(_isOnline); });
    // Update topbar pill if it exists
    _updateStatusPill();
  }

  // ─── PUBLIC API ───
  function isOnline() { return _isOnline; }

  function getStatus() {
    var pending = DataStore.getPendingSyncCount();
    if (_isOnline) {
      var ago = _timeSince(_lastSyncTime);
      return {
        online: true,
        text: 'Online · Last synced ' + ago,
        shortText: 'All changes synced',
        pendingCount: 0,
      };
    } else {
      return {
        online: false,
        text: 'Offline · ' + pending + ' change' + (pending !== 1 ? 's' : '') + ' queued',
        shortText: 'Offline',
        pendingCount: pending,
      };
    }
  }

  function onStatusChange(callback) {
    _callbacks.push(callback);
  }

  function getPendingCount() {
    return DataStore.getPendingSyncCount();
  }

  function getLastSyncTime() { return _lastSyncTime; }

  // ─── STATUS PILL UPDATE ───
  function _updateStatusPill() {
    var pill = document.getElementById('status-pill');
    if (!pill) return;
    var status = getStatus();
    var dot = pill.querySelector('.status-dot');
    var text = pill.querySelector('.status-text');

    if (status.online) {
      pill.className = 'status-pill online';
      if (dot) { dot.className = 'status-dot green'; }
      if (text) { text.textContent = status.text; }
    } else {
      pill.className = 'status-pill offline';
      if (dot) { dot.className = 'status-dot amber'; }
      if (text) { text.textContent = status.text; }
    }
  }

  // ─── TOAST / BANNER ───
  function _showOfflineBanner() {
    if (_hasShownOfflineBanner) return;
    _hasShownOfflineBanner = true;

    var banner = document.getElementById('offline-banner');
    if (banner) {
      banner.classList.add('show');
      setTimeout(function () { banner.classList.remove('show'); }, 5000);
    }
  }

  function _showReconnectToast() {
    _hasShownOfflineBanner = false;
    var banner = document.getElementById('offline-banner');
    if (banner) {
      banner.innerHTML = '<i data-lucide="wifi" style="width:16px;height:16px"></i> Back online — syncing your changes now...';
      banner.classList.add('show');
      banner.style.background = 'var(--color-success-light)';
      banner.style.color = 'var(--color-success-dark)';
      setTimeout(function () {
        banner.classList.remove('show');
        // Reset style
        setTimeout(function() {
          banner.style.background = '';
          banner.style.color = '';
          banner.innerHTML = '<i data-lucide="wifi-off" style="width:16px;height:16px"></i> You\'re offline — KaamFlow still works. Changes will sync when you\'re back online.';
        }, 400);
      }, 3000);
    }
  }

  // ─── HELPERS ───
  function _timeSince(date) {
    var seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';
    var hours = Math.floor(minutes / 60);
    return hours + 'h ago';
  }

  // Start periodic status pill updates
  setInterval(_updateStatusPill, 30000);

  // ─── EXPORT ───
  window.StatusManager = {
    isOnline:        isOnline,
    getStatus:       getStatus,
    onStatusChange:  onStatusChange,
    getPendingCount: getPendingCount,
    getLastSyncTime: getLastSyncTime,
  };
})();
