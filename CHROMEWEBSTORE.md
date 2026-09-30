# Chrome Web Store Publication Metadata

This document contains the necessary metadata and permission justifications required when submitting **YouTube Cinema** to the Chrome Web Store.

## Store Listing Details

- **Name:** YouTube Cinema
- **Short Description:** Cinema mode for YouTube — ad blocker and a clean, distraction-free UI.
- **Detailed Description:** 
  YouTube Cinema transforms your YouTube viewing experience by removing clutter and distractions. It features a powerful, privacy-first ad blocker and a clean "Cinema Mode" interface that hides sidebars, comments, and other visual noise so you can focus entirely on the video.

  Key Features:
  - 🚫 Automatically blocks video ads, banner ads, and tracking scripts
  - 🎬 Clean, distraction-free viewing environment
  - ⚙️ Customizable toggles for hiding UI elements (comments, related videos, etc.)
  - ⚡ Lightweight and fast, using Chrome's declarativeNetRequest API

## Privacy Policy summary

- **Single Purpose:** The single purpose of this extension is to improve the YouTube viewing experience by removing ads and visual clutter.
- **Data Handling:** This extension runs entirely locally in your browser. It does not collect, transmit, or sell any personal data, browsing history, or analytics.

---

## Permission Justifications

When submitting the extension in the `youtube-cinema-chrome/` folder (the Web Store-friendly version), you will need to provide justifications for these permissions in the Developer Dashboard:

### `declarativeNetRequest`
**Justification:** Required to block network requests for advertisements, tracking scripts, and promotional popups on YouTube. This is the core ad-blocking functionality of the extension, implemented using Chrome's modern, privacy-preserving DNR API.

### `storage`
**Justification:** Required to save the user's preferences locally (such as whether the ad blocker is toggled on/off, and which UI elements they have chosen to hide).

### `host_permissions`: `*://*.youtube.com/*`
**Justification:** The extension's core features (ad blocking and CSS/JS UI modification) are exclusively designed to operate on YouTube.com. This permission is necessary to inject the visual cleanup scripts and apply ad-blocking rules to YouTube's domains.

---

## *Note on the Full Version (with Downloader)*
If you ever attempt to publish the full version (from the root folder), you will also need to justify:
- **`nativeMessaging`**: Required to communicate with the local Python host script (`ytcinema_host.py`) which utilizes `yt-dlp` and `FFmpeg` to download and merge high-quality video and audio streams.
- **`downloads`**: Required to track the status of files saved to the user's local disk.
- **`tabs`**: Required to monitor YouTube video navigations and update the download progress UI in the active tab.
