@echo off
echo Updating registry path...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytcinema.host" /ve /t REG_SZ /d "C:\Users\admin\youtube-cinema\native_host\com.ytcinema.host.json" /f
echo.
echo Done! Close Chrome completely and reopen it.
pause
