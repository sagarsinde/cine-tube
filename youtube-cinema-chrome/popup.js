// popup.js — CinemaMode settings (Chrome Web Store version)

'use strict';

const toggleMap = {
  toggleAdblock:  'adBlocker',
  toggleComments: 'hideComments',
  toggleSidebar:  'hideSidebar',
  toggleProgress: 'customProgress'
};

function loadSettings() {
  chrome.storage.sync.get(
    { adBlocker: true, hideComments: true, hideSidebar: false, customProgress: true },
    (s) => {
      Object.entries(toggleMap).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.checked = !!s[key];
      });
    }
  );
}

function handleToggle(e) {
  const key = toggleMap[e.target.id];
  if (!key) return;
  const val = e.target.checked;
  chrome.storage.sync.set({ [key]: val }, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length)
        chrome.tabs.sendMessage(tabs[0].id, { type: 'settingsUpdate', settings: { [key]: val } });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  Object.keys(toggleMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', handleToggle);
  });
});
