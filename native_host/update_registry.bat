@echo off
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytcinema.host" /ve /t REG_SZ /d "C:\Users\admin\youtube-cinema\native_host\com.ytcinema.host.json" /f
echo Registry updated. Restart Chrome to apply changes.
pause
