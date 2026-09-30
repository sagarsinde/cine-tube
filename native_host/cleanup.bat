@echo off
echo Cleaning up for fresh install test...
echo.

echo [1/2] Removing registry entry...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytcinema.host" /f 2>nul
if %errorlevel% equ 0 (
    echo      Registry entry deleted
) else (
    echo      No registry entry found
)

echo [2/2] Removing installed files...
rmdir /s /q "%LOCALAPPDATA%\YTCinema" 2>nul
if exist "%LOCALAPPDATA%\YTCinema" (
    echo      Files still exist
) else (
    echo      Files deleted
)

echo.
echo Done! Now:
echo   1. Go to chrome://extensions/
echo   2. Remove YouTube Cinema extension
echo   3. Click "Load unpacked" again
echo   4. Test the setup flow
echo.
pause
