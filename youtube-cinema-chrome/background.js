// background.js — service worker (Chrome Web Store version)
// Toggles the declarativeNetRequest ad ruleset. inject.js is declared
// statically in the manifest so it always runs at document_start; it reads
// the on/off flag itself.

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
