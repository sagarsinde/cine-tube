# Install YouTube Cinema from ZIP

This file explains how to install the extension locally using `youtube-cinema-release.zip`.

## Steps for non-technical users

1. Download `youtube-cinema-release.zip` from this repository.
2. Right-click the ZIP file and choose **Extract All**.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked**.
6. Select the folder created after extraction.
7. Chrome will load the extension immediately.

## Important notes

- Do not upload this file to the Chrome Web Store directly from ZIP. Use the extracted folder in Chrome Developer mode.
- The zip is meant for local installation only.
- If Chrome asks for permissions, accept them to enable the extension.

## Downloader setup (native host)

If you want the one-click video download feature:

1. Load the extension first using the steps above.
2. Open the `native_host` folder and double-click `install.bat`.
3. Restart Chrome and try the download button on YouTube.

The installer automatically detects the extension, registers it, and installs `yt-dlp` if needed. No manual steps required.

This step is only required for downloads; the extension itself works after the normal `Load unpacked` install.
