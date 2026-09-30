// background.js — service worker
// Handles chrome.downloads (content scripts can't call it directly) and toggles
// the declarativeNetRequest ad ruleset. inject.js is declared statically in the
// manifest so it always runs at document_start; it reads the on/off flag itself.

const AD_RULESET_ID = 'ytc_ads';

function applyAdBlocker(enabled) {
  chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled
      ? { enableRulesetIds: [AD_RULESET_ID] }
      : { disableRulesetIds: [AD_RULESET_ID] }
  ).catch(() => { });
}

function syncAdBlockerFromStorage() {
  chrome.storage.sync.get({ adBlocker: true }, (s) => applyAdBlocker(!!s.adBlocker));
}

chrome.runtime.onInstalled.addListener(syncAdBlockerFromStorage);
chrome.runtime.onStartup.addListener(syncAdBlockerFromStorage);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.adBlocker) {
    applyAdBlocker(!!changes.adBlocker.newValue);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'startNativeDownload') {
    const port = chrome.runtime.connectNative('com.ytcinema.host');

    // Save initial downloading state persistently
    chrome.storage.local.set({
      dlState: {
        active: true,
        percent: 0,
        status: 'started',
        message: 'Connecting to yt-dlp…',
        url: message.url,
        quality: message.quality
      }
    });

    port.onMessage.addListener((msg) => {
      // Update persistent state
      if (msg.status === 'progress') {
        chrome.storage.local.set({
          dlState: {
            active: true,
            percent: parseFloat(msg.percent) || 0,
            status: 'progress',
            message: `Downloading… ${Math.round(parseFloat(msg.percent) || 0)}%`,
            url: message.url,
            quality: message.quality
          }
        });
      } else if (msg.status === 'done') {
        chrome.storage.local.set({
          dlState: { active: false, percent: 100, status: 'done', message: '✅ Saved to Downloads/YouTube Cinema' }
        });
        // Clear state after 5s
        setTimeout(() => chrome.storage.local.remove('dlState'), 5000);
      } else if (msg.status === 'error') {
        chrome.storage.local.set({
          dlState: { active: false, percent: 0, status: 'error', message: '❌ ' + (msg.message || 'Download failed') }
        });
        setTimeout(() => chrome.storage.local.remove('dlState'), 5000);
      } else if (msg.status === 'started') {
        chrome.storage.local.set({
          dlState: { active: true, percent: 0, status: 'started', message: 'Starting download…', url: message.url, quality: message.quality }
        });
      }

      // Relay to content script tab
      if (sender.tab) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'nativeDownloadUpdate', data: msg });
      }

      // Broadcast to popup if open
      chrome.runtime.sendMessage({ type: 'dlStateUpdate', data: msg }).catch(() => {});
    });

    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message;
        const errState = { active: false, percent: 0, status: 'error', message: '❌ ' + errMsg };
        chrome.storage.local.set({ dlState: errState });
        chrome.runtime.sendMessage({ type: 'dlStateUpdate', data: { status: 'error', message: errMsg } }).catch(() => {});
        if (sender.tab) {
          chrome.tabs.sendMessage(sender.tab.id, { type: 'nativeDownloadUpdate', data: { status: 'error', message: errMsg } });
        }
        setTimeout(() => chrome.storage.local.remove('dlState'), 5000);
      }
    });

    port.postMessage({ action: 'download', url: message.url, quality: message.quality });
    sendResponse({ ok: true });
  }

  if (message.type === 'getFormats') {
    let port;
    try {
      port = chrome.runtime.connectNative('com.ytcinema.host');
    } catch (e) {
      sendResponse({ ok: false, error: 'Native host not installed.' });
      return false;
    }

    let responded = false;
    const finish = (result) => {
      if (responded) return;
      responded = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch (e) { }
      sendResponse(result);
    };

    // yt-dlp --dump-json can hang on a slow network; never leave the caller
    // waiting on a response that will not arrive.
    // Increased timeout to 120s for complex videos / slow YouTube responses.
    const timer = setTimeout(
      () => finish({ ok: false, error: 'Timed out fetching formats. Check your connection or try again.' }),
      120000
    );

    port.onMessage.addListener((msg) => {
      // The host emits 'formats' on success and 'error' on failure — both
      // arrive on this channel, so they must be told apart here.
      if (msg && msg.status === 'error') {
        finish({ ok: false, error: msg.message || 'Could not fetch formats.' });
      } else if (msg && msg.status === 'formats') {
        finish({ ok: true, data: msg });
      }
      // Any other status is progress noise — keep waiting.
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      finish({ ok: false, error: err ? err.message : 'Native host disconnected.' });
    });

    port.postMessage({ action: 'getFormats', url: message.url });
    return true; // keep the message channel open for the async response
  }
});

