// Installation and connection-state helpers. Sensitive HTML and API data are
// intentionally excluded from the service-worker cache.
(function () {
  'use strict';

  function updateConnectionBanner() {
    let banner = document.getElementById('offline-banner');
    if (navigator.onLine) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offline-banner';
      banner.className = 'offline-banner';
      banner.textContent = 'Offline: your current form draft will remain on this device until the connection returns.';
      document.body.prepend(banner);
    }
  }

  window.addEventListener('online', updateConnectionBanner);
  window.addEventListener('offline', updateConnectionBanner);
  document.addEventListener('DOMContentLoaded', updateConnectionBanner);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
        // The app remains fully usable without installation support.
      });
    });
  }
})();
