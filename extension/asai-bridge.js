// asai-bridge.js
// Runs only on CordiaClassroom. It announces the extension and mirrors the site's
// existing session into extension storage so students never enter a password twice.
(function () {
  try {
    const API = 'https://autostudy-ai.fly.dev';
    document.documentElement.setAttribute('data-asai-extension', 'ready');

    function announce() {
      window.postMessage({ type: 'ASAI_EXTENSION_READY' }, window.location.origin);
    }

    async function syncAuth(forceRefresh = false) {
      let authToken = localStorage.getItem('authToken') || '';
      let refreshToken = localStorage.getItem('refreshToken') || '';
      const userEmail = localStorage.getItem('userEmail') || '';
      if (forceRefresh && refreshToken) {
        const response = await fetch(API + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.access_token) {
          authToken = data.access_token;
          refreshToken = data.refresh_token || refreshToken;
          localStorage.setItem('authToken', authToken);
          localStorage.setItem('refreshToken', refreshToken);
        } else {
          authToken = '';
          localStorage.removeItem('authToken');
          localStorage.removeItem('refreshToken');
        }
      }
      if (authToken) {
        await chrome.storage.local.set({ authToken, userEmail });
        await chrome.storage.local.remove('refreshToken');
      } else {
        await chrome.storage.local.remove(['authToken', 'refreshToken', 'userEmail']);
      }
      return { success: true, authenticated: Boolean(authToken), userEmail };
    }

    function onMessage(event) {
      if (event.source === window && event.origin === window.location.origin && event.data?.type === 'CORDIA_AUTH_UPDATED') {
        syncAuth();
      }
    }

    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action !== 'syncCordiaAuth') return false;
        syncAuth(Boolean(message.forceRefresh))
          .then(sendResponse)
          .catch(error => sendResponse({ success: false, authenticated: false, error: error.message }));
        return true;
      });
    }

    syncAuth();
    window.addEventListener('message', onMessage);
    // Focus only re-reads the saved session; refreshing here would rotate the token on every focus.
    window.addEventListener('focus', () => syncAuth());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncAuth();
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', announce, { once: true });
    } else {
      announce();
    }
    setTimeout(announce, 1500);
  } catch (e) {
    // Never interfere with the host page.
  }
})();
