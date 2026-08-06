@echo off
:: =====================================================
:: YouTube Cinema — Native Host Installer
:: Run this ONCE after loading the extension in Chrome
:: =====================================================
setlocal enabledelayedexpansion

echo.
echo  ==========================================
echo   YouTube Cinema — Native Host Setup
echo  ==========================================
echo.

:: --- Get the directory of this script ---
set "HOST_DIR=%~dp0"
set "HOST_DIR=%HOST_DIR:~0,-1%"
set "BAT_PATH=%HOST_DIR%\ytcinema_host.bat"
set "MANIFEST_PATH=%HOST_DIR%\com.ytcinema.host.json"

:: --- Ask for Extension ID ---
echo Step 1: Get your Extension ID from chrome://extensions
echo         (Make sure "Developer mode" is ON, then copy the ID)
echo.
set /p EXT_ID="Paste your Extension ID here: "

if "%EXT_ID%"=="" (
    echo ERROR: Extension ID cannot be empty.
    pause
    exit /b 1
)

:: --- Write the manifest JSON with real paths ---
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

echo Manifest written: %MANIFEST_PATH%
echo.

:: --- Register in Windows Registry (HKCU, no admin needed) ---
echo Registering in Windows Registry...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytcinema.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

if %errorlevel% equ 0 (
    echo.
    echo  ==========================================
    echo   Setup Complete!
    echo  ==========================================
    echo.
    echo   yt-dlp check: Make sure yt-dlp is installed.
    echo   Install cmd : winget install yt-dlp
    echo.
    echo   Restart Chrome and try the download button!
    echo.
) else (
    echo.
    echo   ERROR: Registry write failed.
    echo   Try running as Administrator.
    echo.
)

pause
