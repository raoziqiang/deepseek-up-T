@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "RC=0"

rem ============================================================================
rem  Install state\staged\app.asar into DeepSeek Harness resources\app.asar
rem
rem  Usage:
rem    install-whale.cmd          real install  (Harness must be fully quit)
rem    install-whale.cmd /dry     rehearsal: write to state\cmp\ and verify against
rem                               patches\*.yml.  The live install is NOT touched and
rem                               Harness does NOT need to quit.
rem    install-whale.cmd /test    do not pause (for automation; may be combined)
rem
rem  It installs everything in the staged archive, not only the T1 splash:
rem  nothing -> upgrade --stage -> quit Harness -> this script -> restart -> dsht accept
rem
rem  ASCII only on purpose: cmd.exe parses this file with the current code page,
rem  and non-ASCII bytes in commands/labels are a known way to break a .cmd.
rem  The Chinese explanation lives in tracks\T1-appearance\README.md.
rem ============================================================================

echo ==========================================================
if /I "%~1"=="/dry" (
  echo   deepseek-up-T  -  DRY RUN  :  verify staged app.asar
) else (
  echo   deepseek-up-T  -  install staged app.asar
)
echo ==========================================================
echo.
echo   Source : state\staged\app.asar   (checked against patches\*.yml)
if /I "%~1"=="/dry" (
  echo   Target : state\cmp\rehearsal-app.asar  (rehearsal; live install untouched)
) else (
  echo   Target : resources\app.asar under the DeepSeek Harness dir
  echo   Backup : app.asar.whale-backup  (kept; used by --rollback)
)
echo.

if /I "%~1"=="/dry" goto :dry

rem --- guard: app.asar is memory-mapped while Harness runs ---------------
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" /NH /FO CSV 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo [STOP] DeepSeek Harness is still running.
  echo.
  echo   Quit it COMPLETELY first: right-click the tray icon -^> Quit.
  echo   Closing the window is NOT enough - it keeps running in the tray.
  echo.
  echo   Then run this script again.
  echo   Want to check the artifact without quitting?  run:  install-whale.cmd /dry
  set "RC=2"
  goto :done
)

echo Harness is not running. Installing ...
echo.
node "vendor\whale\install.mjs" --yes
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Installed. Start DeepSeek Harness to see the changes.
  echo.
  echo   After it starts, verify everything at once:
  echo       node src\cli.mjs accept
  echo   Splash checklist: tracks\T1-appearance\README.md
) else (
  echo [FAIL] exit code %RC%  -  see the output above.
  echo.
  echo   Rollback: node vendor\whale\install.mjs --rollback
)
goto :done

:dry
echo Rehearsing now: no Harness exit needed, live install untouched ...
echo.
node "vendor\whale\install.mjs" --yes --to "state\cmp\rehearsal-app.asar"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Rehearsal passed: the staged archive matches patches\*.yml exactly.
  echo      The live app.asar was NOT modified. To really install it, quit Harness
  echo      completely and run this script again without /dry.
) else (
  echo [FAIL] exit code %RC%  -  the staged archive does NOT match the declaration.
  echo        Do NOT install it. See the output above.
)

:done
echo.
rem /test may appear anywhere (e.g. install-whale.cmd /dry /test)
for %%A in (%*) do if /I "%%A"=="/test" goto :nopause
pause

:nopause
endlocal & exit /b %RC%
