@echo off
setlocal enabledelayedexpansion

echo.
echo  ==========================================
echo   YouTube Cinema — Native Host Setup
echo  ==========================================
echo.

set "HOST_DIR=%~dp0"
set "HOST_DIR=%HOST_DIR:~0,-1%"
set "BAT_PATH=%HOST_DIR%\ytcinema_host.bat"
set "MANIFEST_PATH=%HOST_DIR%\com.ytcinema.host.json"

:: --- Auto-detect Extension ID from Chrome ---
echo Detecting extension ID...
set "EXT_ID="
set "PREFS=%LOCALAPPDATA%\Google\Chrome\User Data\Default\Preferences"

if not exist "%PREFS%" (
    echo ERROR: Chrome not found. Install Chrome and load the extension first.
    pause
    exit /b 1
)

:: Find the line containing this extension's path in Preferences
:: Chrome stores unpacked extensions like: "ID": {"path": "C:\\Users\\...\\youtube-cinema", ...}
for /f "usebackq tokens=*" %%L in (`findstr /i /c:"youtube-cinema" "%PREFS%"`) do (
    set "LINE=%%L"
    :: Extract 32-char hex ID before the colon
    for /f "tokens=1 delims=:" %%A in ("!LINE!") do (
        set "CANDIDATE=%%A"
        set "CANDIDATE=!CANDIDATE:"=!"
        set "CANDIDATE=!CANDIDATE: =!"
        :: Valid extension IDs are exactly 32 lowercase letters
        echo !CANDIDATE! | findstr /r "^[a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p]$" >nul
        if !errorlevel! equ 0 (
            set "EXT_ID=!CANDIDATE!"
            goto :found
        )
    )
)

:found
if "%EXT_ID%"=="" (
    echo ERROR: YouTube Cinema extension not loaded in Chrome.
    echo.
    echo Steps to fix:
    echo   1. Open Chrome and go to chrome://extensions/
    echo   2. Enable "Developer mode" ^(top-right toggle^)
    echo   3. Click "Load unpacked"
    echo   4. Select folder: %HOST_DIR%
    echo   5. Re-run this installer
    echo.
    pause
    exit /b 1
)

echo Found extension ID: %EXT_ID%
echo.

:: --- Write the manifest JSON ---
echo Writing native messaging manifest...
(
echo {
echo   "name": "com.ytcinema.host",
echo   "description": "YouTube Cinema native download host",
echo   "path": "%BAT_PATH:\=\\%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

:: --- Register in Windows Registry ---
echo Registering in Windows Registry...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytcinema.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1

if %errorlevel% neq 0 (
    echo ERROR: Registry write failed. Try running as Administrator.
    pause
    exit /b 1
)

:: --- Install yt-dlp if missing ---
where yt-dlp >nul 2>&1
if %errorlevel% neq 0 (
    echo yt-dlp not found. Installing automatically...
    winget install yt-dlp --silent --accept-package-agreements --accept-source-agreements
    if !errorlevel! neq 0 (
        echo WARNING: yt-dlp install failed. You can install it manually later:
        echo   winget install yt-dlp
    ) else (
        echo yt-dlp installed successfully.
    )
) else (
    echo yt-dlp already installed.
)

echo.
echo  ==========================================
echo   Setup Complete! Restart Chrome.
echo  ==========================================
echo.
pause
