# Fresh Install Test - YouTube Cinema

## Step 1: Clean Up Your Current Setup
```bash
# Remove registry entry
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytcinema.host" /f

# Remove old AppData files (if any)
rmdir /s /q "%LOCALAPPDATA%\YTCinema"
```

## Step 2: Unload Extension from Chrome
1. Go to `chrome://extensions/`
2. Find "YouTube Cinema"
3. Click **Remove**
4. Close Chrome completely

## Step 3: Fresh Install (As New User Would)
1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select folder: `C:\Users\admin\youtube-cinema`
6. Extension should now appear in the list

## Step 4: Run Install Script
1. Open File Explorer
2. Navigate to: `C:\Users\admin\youtube-cinema\native_host\`
3. Double-click `install.bat`
4. It should:
   - Detect extension ID automatically
   - Register native host
   - Check/install yt-dlp
   - Show "Setup Complete!"

## Step 5: Test the Extension
1. Restart Chrome
2. Go to any YouTube video (try: https://www.youtube.com/watch?v=jNQXAC9IVRw)
3. Click the YouTube Cinema extension icon in toolbar
4. Click **"⬇ Download"** button
5. Wait for format list to load (should take <10 seconds)
6. If it shows formats → SUCCESS! ✅
7. If timeout after 65 seconds → Something's wrong ❌

## Expected Result
- Format list loads within 5-15 seconds
- Shows video title, duration, and quality options
- No "Timed out" error

## If It Still Times Out
Check the console:
1. Right-click extension icon → Inspect popup
2. Check Console tab for errors
3. Take a screenshot and send it
