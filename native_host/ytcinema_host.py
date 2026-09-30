#!/usr/bin/env python3
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
    """Find yt-dlp executable — checks PATH, host folder, winget, and common pip/pipx install locations."""
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
    """Find ffmpeg binary — checks PATH, native host folder, then winget install location."""
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
        match = re.match(r'^(\d+)p$', str(quality))
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
