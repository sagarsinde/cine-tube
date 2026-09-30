@echo off
echo Cleaning up current installation...
echo.

echo Removing registry entry...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytcinema.host" /f

echo Removing old AppData files...
if exist "%LOCALAPPDATA%\YTCinema" rmdir /s /q "%LOCALAPPDATA%\YTCinema"
if exist "%LOCALAPPDATA%\YTCinema" (
    echo ERROR: Could not remove AppData folder
) else (
    echo AppData folder cleaned.
)

echo.
echo Cleanup complete! Now:
echo 1. Go to chrome://extensions/
echo 2. Remove YouTube Cinema extension
echo 3. Close Chrome completely
echo 4. Then reload extension and run install.bat
echo.
pause
