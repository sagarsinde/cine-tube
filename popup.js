// popup.js — CinemaMode | Auto-setup + Download + Settings

'use strict';

// ─────────────────────────────────────────────────────────
// PYTHON HOST SCRIPT (embedded — written to disk by setup)
// ─────────────────────────────────────────────────────────
const PYTHON_HOST_SCRIPT = `#!/usr/bin/env python3
import sys, json, struct, subprocess, os, threading

def read_message():
    raw = sys.stdin.buffer.read(4)
    if not raw: return None
    length = struct.unpack('=I', raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))

def send_message(data):
    enc = json.dumps(data).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(enc)))
    sys.stdout.buffer.write(enc)
    sys.stdout.buffer.flush()

def download_video(url, quality):
    dl_dir = os.path.join(os.path.expanduser('~'), 'Downloads', 'YouTube Cinema')
    os.makedirs(dl_dir, exist_ok=True)
    fmt_map = {
        'best':  'bestvideo+bestaudio/best',
        '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
        '720p':  'bestvideo[height<=720]+bestaudio/best[height<=720]',
        '480p':  'bestvideo[height<=480]+bestaudio/best[height<=480]',
        'audio': 'bestaudio/best',
    }
    fmt = fmt_map.get(quality, fmt_map['best'])
    out = os.path.join(dl_dir, '%(title)s.%(ext)s')

    # Try to find yt-dlp (including local copy)
    host_dir = os.path.dirname(os.path.abspath(__file__))
    local_ytdlp = os.path.join(host_dir, 'yt-dlp.exe')
    ytdlp_cmd = local_ytdlp if os.path.exists(local_ytdlp) else 'yt-dlp'

    if quality == 'audio':
        cmd = [ytdlp_cmd, '--format', fmt, '--extract-audio',
               '--audio-format', 'mp3', '--audio-quality', '0',
               '--output', out, '--no-playlist', '--newline', url]
    else:
        cmd = [ytdlp_cmd, '--format', fmt, '--merge-output-format', 'mp4',
               '--output', out, '--no-playlist', '--newline', url]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        send_message({'status': 'started', 'message': 'Downloading...'})
        for line in proc.stdout:
            line = line.strip()
            if '[download]' in line and '%' in line:
                try:
                    parts = [p for p in line.split() if '%' in p]
                    if parts:
                        send_message({'status': 'progress',
                                      'percent': parts[0].replace('%','')})
                except Exception: pass
        proc.wait()
        if proc.returncode == 0:
            send_message({'status': 'done', 'folder': dl_dir})
        else:
            send_message({'status': 'error',
                          'message': 'Download failed. Try updating yt-dlp.'})
    except FileNotFoundError:
        send_message({'status': 'error',
                      'message': 'yt-dlp not found. Re-run setup.'})
    except Exception as e:
        send_message({'status': 'error', 'message': str(e)})

while True:
    msg = read_message()
    if msg is None: break
    if msg.get('action') == 'download':
        download_video(msg.get('url',''), msg.get('quality','best'))
    elif msg.get('action') == 'ping':
        send_message({'status': 'ok'})
`;

// ─────────────────────────────────────────────────────────
// GENERATE SELF-INSTALLING BATCH FILE
// ─────────────────────────────────────────────────────────
function generateSetupBat(extensionId) {
  // Escape backslashes for echoing inside batch
  const pyLines = PYTHON_HOST_SCRIPT
    .split('\n')
    .map(l => l
      .replace(/%/g, '%%')    // escape % in batch
      .replace(/>/g, '^>')    // escape redirection chars
      .replace(/</g, '^<')
      .replace(/&/g, '^&')
      .replace(/\|/g, '^|')
    )
    .join('\r\n');

  return `@echo off
setlocal enabledelayedexpansion
title YouTube Cinema - Auto Setup
color 0A
echo.
echo  ================================================
echo   YouTube Cinema - Auto Setup
echo   This will take about 30 seconds...
echo  ================================================
echo.

:: Create host directory
set "HOSTDIR=%LOCALAPPDATA%\\YTCinema"
if not exist "%HOSTDIR%" mkdir "%HOSTDIR%"

echo [1/4] Writing download engine...

:: Write Python host script
(
${pyLines}
) > "%HOSTDIR%\\ytcinema_host.py"

:: Write batch wrapper
(
echo @echo off
echo python "%%~dp0ytcinema_host.py" %%*
) > "%HOSTDIR%\\ytcinema_host.bat"

echo [2/4] Registering extension connection...

:: Write native messaging manifest
set "BATPATH=%HOSTDIR%\\ytcinema_host.bat"
set "JSONPATH=%HOSTDIR%\\com.ytcinema.host.json"
set "EXTID=${extensionId}"

(
echo {
echo   "name": "com.ytcinema.host",
echo   "description": "YouTube Cinema native download host",
echo   "path": "%BATPATH:\\=\\\\%",
echo   "type": "stdio",
echo   "allowed_origins": ["chrome-extension://%EXTID%/"]
echo }
) > "%JSONPATH%"

:: Register in Windows Registry (no admin needed)
reg add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ytcinema.host" /ve /t REG_SZ /d "%JSONPATH%" /f >nul 2>&1

echo [3/4] Installing yt-dlp...

:: Check if yt-dlp already installed
where yt-dlp >nul 2>&1
if %errorlevel% equ 0 (
    echo      yt-dlp already installed, skipping.
    goto :done_ytdlp
)

:: Try winget first
winget install yt-dlp --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
where yt-dlp >nul 2>&1
if %errorlevel% equ 0 goto :done_ytdlp

:: Fallback: download yt-dlp.exe directly into host directory
echo      Downloading yt-dlp directly...
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '%HOSTDIR%\\yt-dlp.exe' -UseBasicParsing" >nul 2>&1

:done_ytdlp

echo [4/4] Finalizing...
timeout /t 1 /nobreak >nul

echo.
echo  ================================================
echo   Setup Complete!
echo   Restart Chrome and click the extension icon.
echo  ================================================
echo.
pause
`;
}

// ─────────────────────────────────────────────────────────
// CHECK IF NATIVE HOST IS INSTALLED
// ─────────────────────────────────────────────────────────
function checkHostInstalled(callback) {
  let connected = false;
  try {
    const port = chrome.runtime.connectNative('com.ytcinema.host');
    port.onMessage.addListener((msg) => {
      if (msg.status === 'ok') {
        connected = true;
        port.disconnect();
        callback(true);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!connected) callback(false);
    });
    // Send ping
    port.postMessage({ action: 'ping' });
    // Timeout fallback
    setTimeout(() => { if (!connected) { port.disconnect(); callback(false); } }, 1500);
  } catch (e) {
    callback(false);
  }
}

// ─────────────────────────────────────────────────────────
// VIEWS
// ─────────────────────────────────────────────────────────
function showView(name) {
  document.getElementById('setup-view').style.display = name === 'setup' ? 'block' : 'none';
  document.getElementById('main-view').style.display  = name === 'main'  ? 'block' : 'none';
}

function setStep(n) {
  [1,2,3].forEach(i => {
    const el = document.getElementById('step' + i);
    el.classList.remove('active','done');
    if (i < n)  el.classList.add('done');
    if (i === n) el.classList.add('active');
  });
}

// ─────────────────────────────────────────────────────────
// SETUP FLOW
// ─────────────────────────────────────────────────────────
function initSetupView() {
  setStep(1);

  document.getElementById('setupBtn').addEventListener('click', () => {
    const btn = document.getElementById('setupBtn');
    const status = document.getElementById('setupStatus');

    btn.disabled = true;
    document.getElementById('setupBtnText').textContent = '⏳ Generating setup file…';
    setStep(1);
    status.textContent = 'Preparing your setup file…';
    status.className = 'setup-status';

    // Get this extension's own ID — no manual input needed!
    const extensionId = chrome.runtime.id;
    const batContent = generateSetupBat(extensionId);
    const blob = new Blob([batContent], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: 'ytcinema_setup.bat',
      saveAs: false   // save directly, no dialog
    }, (downloadId) => {
      URL.revokeObjectURL(url);
      if (chrome.runtime.lastError || !downloadId) {
        status.textContent = '❌ Download failed. Try again.';
        status.className = 'setup-status error';
        btn.disabled = false;
        document.getElementById('setupBtnText').textContent = '⚡ Auto Setup';
        return;
      }

      // Step 2 — show download arrow
      setStep(2);
      document.getElementById('setupBtnText').textContent = '✅ File Downloaded!';
      status.textContent = 'Double-click the file to install everything automatically.';
      status.className = 'setup-status done';
      document.getElementById('setupArrow').style.display = 'block';
      setStep(2);

      // Re-enable button after 3s so user can retry if needed
      setTimeout(() => {
        btn.disabled = false;
        document.getElementById('setupBtnText').textContent = '↩ Re-download Setup';
      }, 3000);
    });
  });

  document.getElementById('skipBtn').addEventListener('click', () => {
    showView('main');
    initMainView();
  });
}

// ─────────────────────────────────────────────────────────
// MAIN VIEW — DOWNLOAD LOGIC
// ─────────────────────────────────────────────────────────
let selectedQuality = null;
let currentVideoUrl = null;
let isDownloading   = false;

function setDlStatus(msg, type = '') {
  const el = document.getElementById('dlStatus');
  el.textContent = msg;
  el.className = 'dl-status ' + type;
}

function setProgress(pct) {
  document.getElementById('dlProgressWrap').style.display = 'flex';
  document.getElementById('dlProgressBar').style.setProperty('--pct', pct + '%');
  document.getElementById('dlProgressPct').textContent = pct + '%';
}

function resetProgress() {
  document.getElementById('dlProgressWrap').style.display = 'none';
  document.getElementById('dlProgressBar').style.setProperty('--pct', '0%');
}

function setDlBtn(enabled, text) {
  document.getElementById('dlBtn').disabled = !enabled;
  document.getElementById('dlBtnText').textContent = text;
}

// ─────────────────────────────────────────────────────────
// PERSISTENT DOWNLOAD BANNER
// ─────────────────────────────────────────────────────────
function updateBanner(dlState) {
  const banner = document.getElementById('dl-banner');
  if (!banner) return;
  if (!dlState || dlState.status === undefined) {
    banner.style.display = 'none';
    return;
  }
  const { active, percent, status, message } = dlState;
  if (status === 'done' || status === 'error') {
    banner.style.display = 'flex';
    banner.className = status === 'done' ? 'dl-banner-done' : 'dl-banner-error';
    document.getElementById('dlBannerTitle').textContent = message || (status === 'done' ? '✅ Done!' : '❌ Failed');
    document.getElementById('dlBannerPct').textContent = status === 'done' ? '100%' : '';
    document.getElementById('dlBannerFill').style.width = status === 'done' ? '100%' : '0%';
    return;
  }
  if (active) {
    banner.style.display = 'flex';
    banner.className = '';
    const pct = Math.round(percent || 0);
    document.getElementById('dlBannerTitle').textContent = message || 'Downloading…';
    document.getElementById('dlBannerPct').textContent = pct + '%';
    document.getElementById('dlBannerFill').style.width = pct + '%';
  } else {
    banner.style.display = 'none';
  }
}

function restoreDownloadState() {
  chrome.storage.local.get('dlState', ({ dlState }) => {
    if (dlState) updateBanner(dlState);
  });
}

// Listen for live updates from background while popup is open
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'dlStateUpdate') {
    chrome.storage.local.get('dlState', ({ dlState }) => {
      if (dlState) updateBanner(dlState);
    });
  }
});

function detectVideo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    const tab = tabs[0];
    const url = tab.url || '';
    if (url.includes('youtube.com/watch')) {
      currentVideoUrl = url;
      const title = (tab.title || 'YouTube Video').replace(' - YouTube','').trim();
      document.getElementById('videoTitle').textContent =
        title.length > 34 ? title.substring(0, 34) + '…' : title;
      try {
        const vid = new URL(url).searchParams.get('v');
        document.getElementById('videoUrl').textContent = 'youtu.be/' + vid;
      } catch { document.getElementById('videoUrl').textContent = url; }
      setDlStatus('Reading available qualities…');
      loadQualities(url);
    } else {
      currentVideoUrl = null;
      document.getElementById('videoTitle').textContent = 'Open a YouTube video first';
      document.getElementById('videoUrl').textContent = '—';
      clearQualities();
      setDlBtn(false, '⬇  Download');
    }
  });
}

// ─────────────────────────────────────────────────────────
// QUALITY OPTIONS — read from the video itself via yt-dlp
// ─────────────────────────────────────────────────────────
function setQualityNote(text, isError = false) {
  const note = document.getElementById('qualityNote');
  if (!note) return;
  note.textContent = text;
  note.className = 'quality-note' + (isError ? ' error' : '');
}

function clearQualities() {
  selectedQuality = null;
  const row = document.getElementById('qualityRow');
  if (row) row.replaceChildren();
  setQualityNote('');
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

function renderQualities(data) {
  const row = document.getElementById('qualityRow');
  if (!row) return;

  const options = (data.video_options || []).map((v) => {
    const bits = [];
    if (v.fps && v.fps >= 50) bits.push(`${Math.round(v.fps)}fps`);
    if (v.ext) bits.push(v.ext.toUpperCase());
    const size = fmtSize(v.filesize);
    if (size) bits.push(size);
    return { label: v.label, qualityId: v.quality_id, title: bits.join(' · '), audio: false };
  });

  if (data.has_audio) {
    options.push({
      label: 'MP3',
      qualityId: 'audio',
      title: ['Audio only', fmtSize(data.audio_filesize)].filter(Boolean).join(' · '),
      audio: true
    });
  }

  if (!options.length) {
    row.replaceChildren();
    selectedQuality = null;
    setQualityNote('No downloadable formats found for this video.', true);
    setDlBtn(false, '⬇  Download');
    return;
  }

  // Labels come from the video's own metadata, so build nodes rather than markup.
  const buttons = options.map((opt) => {
    const btn = document.createElement('button');
    btn.className = 'q-btn' + (opt.audio ? ' audio' : '');
    btn.textContent = opt.label;
    if (opt.title) btn.title = opt.title;
    btn.addEventListener('click', () => {
      row.querySelectorAll('.q-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedQuality = opt.qualityId;
      setQualityNote(opt.title || '');
    });
    return btn;
  });

  row.replaceChildren(...buttons);

  // Default to the highest real quality the video offers.
  buttons[0].classList.add('selected');
  selectedQuality = options[0].qualityId;
  setQualityNote(options[0].title || '');

  setDlBtn(true, '⬇  Download');
  setDlStatus('Ready — pick quality and download');
}

function loadQualities(url) {
  clearQualities();
  setDlBtn(false, '⬇  Download');
  setQualityNote('Loading qualities…');

  chrome.runtime.sendMessage({ type: 'getFormats', url }, (resp) => {
    // The popup can be closed and reopened on a different video mid-request.
    if (url !== currentVideoUrl) return;

    if (chrome.runtime.lastError || !resp || !resp.ok) {
      const reason = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : (resp && resp.error) || 'Could not read qualities.';
      setQualityNote(reason, true);
      setDlStatus('❌ ' + reason, 'error');
      setDlBtn(false, '⬇  Download');
      return;
    }

    renderQualities(resp.data);
  });
}

function startDownload() {
  if (!currentVideoUrl || isDownloading) return;
  if (!selectedQuality) {
    setDlStatus('Pick a quality first', 'error');
    return;
  }
  isDownloading = true;
  setDlBtn(false, '⏳ Downloading…');
  setDlStatus('Connecting to yt-dlp…');
  resetProgress();

  const port = chrome.runtime.connectNative('com.ytcinema.host');

  port.onMessage.addListener((msg) => {
    if (msg.status === 'started') {
      setDlStatus('Starting download…');
    } else if (msg.status === 'progress') {
      const pct = Math.round(parseFloat(msg.percent) || 0);
      setProgress(pct);
      setDlStatus(`Downloading… ${pct}%`);
    } else if (msg.status === 'done') {
      setProgress(100);
      setDlStatus('✅ Saved to Downloads/YouTube Cinema', 'done');
      setDlBtn(true, '⬇  Download');
      isDownloading = false;
      port.disconnect();
    } else if (msg.status === 'error') {
      setDlStatus('❌ ' + (msg.message || 'Download failed'), 'error');
      setDlBtn(true, '⬇  Download');
      isDownloading = false;
      resetProgress();
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (isDownloading) {
      setDlStatus('❌ Host not found — run setup again', 'error');
      setDlBtn(true, '⬇  Download');
      isDownloading = false;
      resetProgress();
    }
  });

  port.postMessage({ action: 'download', url: currentVideoUrl, quality: selectedQuality });
}

// ─────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────
const toggleMap = {
  toggleAdblock:  'adBlocker',
  toggleGlobalAds: 'globalAdBlock',
  toggleComments: 'hideComments',
  toggleSidebar:  'hideSidebar',
  toggleProgress: 'customProgress'
};

function loadSettings() {
  chrome.storage.sync.get(
    { adBlocker: true, globalAdBlock: true, hideComments: true, hideSidebar: false, customProgress: true },
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

function initMainView() {
  loadSettings();
  detectVideo();
  restoreDownloadState(); // Restore any active download state from storage

  Object.keys(toggleMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', handleToggle);
  });

  document.getElementById('dlBtn').addEventListener('click', startDownload);
}

// ─────────────────────────────────────────────────────────
// BOOT — decide which view to show
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkHostInstalled((installed) => {
    if (installed) {
      showView('main');
      initMainView();
    } else {
      showView('setup');
      initSetupView();
    }
  });
});
