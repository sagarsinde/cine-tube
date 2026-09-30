@echo off
echo Checking Chrome extensions folder...
echo.

set "CHROME_EXT=%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions"

if not exist "%CHROME_EXT%" (
    echo ERROR: Folder does not exist: %CHROME_EXT%
    pause
    exit /b 1
)

echo Found extensions folder: %CHROME_EXT%
echo.
echo Installed extensions:
echo.

for /d %%E in ("%CHROME_EXT%\*") do (
    echo Extension ID: %%~nxE
    for /d %%V in ("%%E\*") do (
        if exist "%%V\manifest.json" (
            echo   Version: %%~nxV
            findstr /i "\"name\"" "%%V\manifest.json"
            echo.
        )
    )
)

pause
