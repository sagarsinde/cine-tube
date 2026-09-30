// popup.js — CinemaMode | Auto-setup + Download + Settings

'use strict';

// ─────────────────────────────────────────────────────────
// PYTHON HOST SCRIPT (embedded — written to disk by setup)
// ─────────────────────────────────────────────────────────
const PYTHON_HOST_SCRIPT = `#!/usr/bin/env python3
"""
YouTube Cinema — Native Messaging Host
Receives a YouTube URL from the Chrome extension and downloads it via yt-dlp.
"""

import sys
import json
import struct
import subprocess
import os
import re
import threading
import shutil

def find_ytdlp():
    """Find yt-dlp executable — checks PATH, host folder, winget, and pip locations."""
    # 1. Check if it's already on PATH
    found = shutil.which('yt-dlp')
    if found:
        return found

    # 2. Check the native host directory for a bundled yt-dlp.exe
    script_dir = os.path.dirname(os.path.abspath(__file__))
    local_exe = os.path.join(script_dir, 'yt-dlp.exe')
    if os.path.isfile(local_exe):
        return local_exe
    local_unix = os.path.join(script_dir, 'yt-dlp')
    if os.path.isfile(local_unix):
        return local_unix

    # 3. Check common winget install location
    local_app = os.environ.get('LOCALAPPDATA', '')
    winget_pattern = os.path.join(local_app, 'Microsoft', 'WinGet', 'Packages')
    if os.path.isdir(winget_pattern):
        for folder in os.listdir(winget_pattern):
            if 'yt-dlp.yt-dlp' in folder:
                candidate = os.path.join(winget_pattern, folder, 'yt-dlp.exe')
                if os.path.isfile(candidate):
                    return candidate

    # 4. Check common pip/pipx install locations
    user_scripts = os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming', 'Python', 'Scripts', 'yt-dlp.exe')
    if os.path.isfile(user_scripts):
        return user_scripts

    return None

YTDLP_PATH = find_ytdlp()

def find_ffmpeg():
    """Find ffmpeg binary — checks PATH, host folder, then winget install location."""
    found = shutil.which('ffmpeg')
    if found:
        return os.path.dirname(found)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    local_exe = os.path.join(script_dir, 'ffmpeg.exe')
    if os.path.isfile(local_exe):
        return script_dir
    local_unix = os.path.join(script_dir, 'ffmpeg')
    if os.path.isfile(local_unix):
        return script_dir

    local_app = os.environ.get('LOCALAPPDATA', '')
    winget_pattern = os.path.join(local_app, 'Microsoft', 'WinGet', 'Packages')
    if os.path.isdir(winget_pattern):
        for folder in os.listdir(winget_pattern):
            if 'yt-dlp.FFmpeg' in folder:
                for root, dirs, files in os.walk(os.path.join(winget_pattern, folder)):
                    if 'ffmpeg.exe' in files:
                        return root
    return None

FFMPEG_DIR = find_ffmpeg()

def read_message():
    """Read a native message from Chrome (4-byte length prefix + JSON)."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('=I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(data):
    """Send a native message back to Chrome."""
    encoded = json.dumps(data).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def download_video(url, quality):
    """Run yt-dlp to download the video."""
    downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads', 'YouTube Cinema')
    os.makedirs(downloads_dir, exist_ok=True)

    # Quality format selection. Heights are parsed from the quality id rather
    # than looked up in a fixed table, because the picker now offers whatever
    # heights the video actually has (144p, 4320p, …) instead of a fixed list.
    if quality == 'audio':
        fmt = 'bestaudio/best'
    elif quality == 'best':
        fmt = 'bestvideo+bestaudio/best'
    else:
        match = re.match(r'^(\\d+)p$', str(quality))
        if match:
            h = int(match.group(1))
            fmt = f'bestvideo[height<={h}]+bestaudio/best[height<={h}]'
        else:
            fmt = 'bestvideo+bestaudio/best'

    output_template = os.path.join(downloads_dir, '%(title)s [%(height)sp].%(ext)s')
    if quality == 'audio':
        output_template = os.path.join(downloads_dir, '%(title)s.%(ext)s')

    if not YTDLP_PATH:
        send_message({'status': 'error', 'message': 'yt-dlp not found. Install it: winget install yt-dlp'})
        return

    # Build base flags, including ffmpeg location for merging
    ffmpeg_flags = ['--ffmpeg-location', FFMPEG_DIR] if FFMPEG_DIR else []

    cmd = [
        YTDLP_PATH,
        '--format', fmt,
        '--merge-output-format', 'mp4',
        '--output', output_template,
        '--no-playlist',
        '--progress',
        '--newline',
    ] + ffmpeg_flags + [url]

    if quality == 'audio':
        cmd = [
            YTDLP_PATH,
            '--format', fmt,
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '--output', output_template,
            '--no-playlist',
            '--newline',
        ] + ffmpeg_flags + [url]

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )

        send_message({'status': 'started', 'message': f'Downloading ({quality})...'})

        for line in process.stdout:
            line = line.strip()
            if '[download]' in line and '%' in line:
                # Parse progress percentage
                try:
                    part = [p for p in line.split() if '%' in p]
                    if part:
                        pct = part[0].replace('%', '')
                        send_message({'status': 'progress', 'percent': pct})
                except Exception:
                    pass

        process.wait()

        if process.returncode == 0:
            send_message({'status': 'done', 'message': f'Saved to ~/Downloads/YouTube Cinema/', 'folder': downloads_dir})
        else:
            send_message({'status': 'error', 'message': 'yt-dlp failed. Make sure yt-dlp is installed and up to date.'})

    except FileNotFoundError:
        send_message({
            'status': 'error',
            'message': f'yt-dlp not found at {YTDLP_PATH}. Try reinstalling: winget install yt-dlp'
        })
    except Exception as e:
        send_message({'status': 'error', 'message': str(e)})

def get_formats(url):
    """Fetch available formats for a video using yt-dlp --dump-json."""
    if not YTDLP_PATH:
        send_message({'status': 'error', 'message': 'yt-dlp not found.'})
        return

    try:
        ffmpeg_flags = ['--ffmpeg-location', FFMPEG_DIR] if FFMPEG_DIR else []
        cmd = [YTDLP_PATH, '--dump-json', '--no-playlist', '--no-warnings'] + ffmpeg_flags + [url]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            send_message({'status': 'error', 'message': 'Could not fetch video formats.'})
            return

        data = json.loads(result.stdout)
        formats = data.get('formats', [])
        title = data.get('title', 'Video')
        duration = data.get('duration', 0)

        # Best variant per height. yt-dlp lists several encodings for the same
        # height (av01/vp9/avc1); keep whichever has the highest bitrate so the
        # size estimate shown in the picker matches what actually downloads.
        best_by_height = {}
        audio_size = 0

        for f in formats:
            vcodec = f.get('vcodec') or 'none'
            acodec = f.get('acodec') or 'none'
            size = f.get('filesize') or f.get('filesize_approx') or 0

            if vcodec == 'none' and acodec != 'none':
                audio_size = max(audio_size, size or 0)
                continue

            h = f.get('height')
            if not h or vcodec == 'none':
                continue

            tbr = f.get('tbr') or f.get('vbr') or 0
            existing = best_by_height.get(h)
            if existing is None or (tbr or 0) > (existing.get('tbr') or 0):
                best_by_height[h] = {
                    'label': f'{h}p',
                    'height': h,
                    'quality_id': f'{h}p',
                    'ext': f.get('ext', 'mp4'),
                    'fps': f.get('fps'),
                    'tbr': round(tbr) if tbr else None,
                    'filesize': size or None
                }

        video_options = sorted(
            best_by_height.values(), key=lambda x: x['height'], reverse=True
        )

        # Video-only streams get merged with an audio track, so include the
        # audio bytes in the estimate.
        for opt in video_options:
            if opt['filesize'] and audio_size:
                opt['filesize'] = opt['filesize'] + audio_size

        send_message({
            'status': 'formats',
            'title': title,
            'duration': duration,
            'video_options': video_options,
            'audio_filesize': audio_size or None,
            'has_audio': audio_size > 0
        })

    except subprocess.TimeoutExpired:
        send_message({'status': 'error', 'message': 'Timed out fetching formats.'})
    except Exception as e:
        send_message({'status': 'error', 'message': str(e)})


def main():
    while True:
        message = read_message()
        if message is None:
            break
        action = message.get('action')
        if action == 'download':
            url = message.get('url', '')
            quality = message.get('quality', 'best')
            # Run download in background so we can send updates
            t = threading.Thread(target=download_video, args=(url, quality), daemon=True)
            t.start()
            t.join()
        elif action == 'getFormats':
            url = message.get('url', '')
            t = threading.Thread(target=get_formats, args=(url,), daemon=True)
            t.start()
            t.join()
        elif action == 'ping':
            send_message({'status': 'ok', 'message': 'Native host is running'})

if __name__ == '__main__':
    main()
`;

// ─────────────────────────────────────────────────────────
// GENERATE SELF-INSTALLING BATCH FILE
// ─────────────────────────────────────────────────────────
function generateSetupBat(extensionId) {
  // Base64 encode Python script to avoid batch escaping issues
  const pyBase64 = btoa(PYTHON_HOST_SCRIPT);

  return `@echo off
setlocal enabledelayedexpansion
title YouTube Cinema Setup
color 0B
mode con cols=65 lines=20
echo.
echo  =============================================================
echo   YouTube Cinema - Installer
echo  =============================================================
echo.
echo  This installer will:
echo    - Install yt-dlp (video downloader)
echo    - Connect the extension to the downloader
echo.
echo  Takes about 30 seconds. Keep this window open.
echo  =============================================================
echo.

:: Create host directory
set "HOSTDIR=%LOCALAPPDATA%\\YTCinema"
if not exist "%HOSTDIR%" mkdir "%HOSTDIR%"

echo [1/4] Writing download engine...

:: Write Python host script using PowerShell (avoids batch escaping hell)
powershell -NoProfile -Command "[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${pyBase64}')) | Out-File -FilePath '%HOSTDIR%\\ytcinema_host.py' -Encoding UTF8"

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
echo  =============================================================
echo   Setup Complete!
echo  =============================================================
echo.
echo  What to do next:
echo    1. Close Chrome completely
echo    2. Reopen Chrome
echo    3. Click the YouTube Cinema icon
echo.
echo  The downloader is now ready to use!
echo  =============================================================
echo.
echo  Press any key to close this window...
pause >nul
exit
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
      status.textContent = '📁 Open your Downloads folder and double-click "ytcinema_setup.bat" to install.';
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
  toggleAdblock:    'adBlocker',
  toggleGlobalAds:  'globalAdBlock',
  toggleComments:   'hideComments',
  toggleSidebar:    'hideSidebar',
  toggleProgress:   'customProgress',
  toggleSponsorSkip: 'sponsorSkip'
};

function loadSettings() {
  chrome.storage.sync.get(
    { adBlocker: true, globalAdBlock: true, hideComments: true, hideSidebar: false, customProgress: true, sponsorSkip: true },
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
