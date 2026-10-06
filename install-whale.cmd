@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "RC=0"

echo ==========================================================
echo   deepseek-up-T  -  T1 whale splash  :  install to app.asar
echo ==========================================================
echo.
echo   Source : state\staged\app.asar   (verified: 11 entries)
echo   Target : resources\app.asar under the DeepSeek Harness dir
echo   Backup : app.asar.whale-backup   (kept, used by --rollback)
echo.

rem --- guard: app.asar is memory-mapped while Harness runs ---------------
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" /NH /FO CSV 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo [STOP] DeepSeek Harness is still running.
  echo.
  echo   Quit it COMPLETELY first: right-click the tray icon -^> Quit.
  echo   Closing the window is NOT enough - it keeps running in the tray.
  echo.
  echo   Then run this script again.
  set "RC=2"
  goto :done
)

echo Harness is not running. Installing ...
echo.
node "vendor\whale\install.mjs" --yes
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Installed. Start DeepSeek Harness to see the new splash screen.
  echo.
  echo   Then verify with:  node src\cli.mjs upgrade
  echo   Checklist:         tracks\T1-appearance\README.md
) else (
  echo [FAIL] exit code %RC%  -  see the output above.
  echo.
  echo   Rollback:  node vendor\whale\install.mjs --rollback
)

:done
echo.
if /I not "%~1"=="/test" pause
endlocal & exit /b %RC%
