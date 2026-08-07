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

:: --- Auto-detect Extension ID from Chrome profile ---
echo Detecting extension ID...
set "EXT_ID="
set "CHROME_EXT=%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions"

if not exist "%CHROME_EXT%" (
    echo ERROR: Chrome extensions folder not found.
    echo Make sure Chrome is installed and YouTube Cinema has been loaded via Load unpacked.
    pause
    exit /b 1
)

for /d %%E in ("%CHROME_EXT%\*") do (
    for /d %%V in ("%%E\*") do (
        if exist "%%V\manifest.json" (
            findstr /i /c:"YouTube Cinema" "%%V\manifest.json" >nul 2>&1
            if !errorlevel! equ 0 (
                set "EXT_ID=%%~nxE"
            )
        )
    )
)

if "%EXT_ID%"=="" (
    echo ERROR: YouTube Cinema extension not found in Chrome.
    echo Please load it first via chrome://extensions > Load unpacked.
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
