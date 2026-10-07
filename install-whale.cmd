@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "RC=0"
set "MODE=install"
set "DRY=0"
set "NOPAUSE=0"

rem ============================================================================
rem  Install - or roll back - the DeepSeek Harness resources\app.asar.
rem
rem  Usage:
rem    install-whale.cmd                 real install  (Harness must be fully quit)
rem    install-whale.cmd /dry            rehearsal of the install: write to
rem                                      state\cmp\ and verify against patches\*.yml.
rem                                      The live install is NOT touched and Harness
rem                                      does NOT need to quit.
rem    install-whale.cmd /rollback       restore app.asar from app.asar.whale-backup
rem                                      (Harness must be fully quit)
rem    install-whale.cmd /rollback /dry  rehearsal of the rollback: write the restored
rem                                      copy to state\cmp\ and verify it byte for
rem                                      byte.  Live install NOT touched, Harness may
rem                                      keep running.
rem    install-whale.cmd /test           do not pause (for automation; may be
rem                                      combined with any of the above)
rem
rem  Flags may appear in any order.  The rollback path deliberately does NOT need
rem  an extra confirmation flag: it is the command you run when something already
rem  went wrong, and it prints itself in the failure message so it can be copied
rem  verbatim.  The Harness guard applies to it all the same.
rem
rem  It handles everything built into the staged archive, not only the T1 splash:
rem  nothing -> upgrade --stage -> quit Harness -> this script -> restart -> dsht accept
rem
rem  ASCII only on purpose: cmd.exe parses this file with the current code page,
rem  and non-ASCII bytes in commands/labels are a known way to break a .cmd.
rem  The Chinese explanation lives in tracks\T1-appearance\README.md and
rem  docs\03-workflow.md.
rem ============================================================================

if not "%~1"=="" for %%A in (%*) do (
  if /I "%%A"=="/dry" set "DRY=1"
  if /I "%%A"=="/rollback" set "MODE=rollback"
  if /I "%%A"=="/test" set "NOPAUSE=1"
)

echo ==========================================================
if "%MODE%"=="rollback" (
  if "%DRY%"=="1" (
    echo   deepseek-up-T  -  ROLLBACK DRY RUN  :  check the backup
  ) else (
    echo   deepseek-up-T  -  ROLLBACK  :  restore app.asar from backup
  )
) else (
  if "%DRY%"=="1" (
    echo   deepseek-up-T  -  DRY RUN  :  verify staged app.asar
  ) else (
    echo   deepseek-up-T  -  install staged app.asar
  )
)
echo ==========================================================
echo.
if "%MODE%"=="rollback" (
  echo   Source : app.asar.whale-backup  ^(the original archive^)
) else (
  echo   Source : state\staged\app.asar  ^(checked against patches\*.yml^)
)
if "%DRY%"=="1" (
  if "%MODE%"=="rollback" (
    echo   Target : state\cmp\rollback-rehearsal.asar  ^(rehearsal; live install untouched^)
  ) else (
    echo   Target : state\cmp\rehearsal-app.asar  ^(rehearsal; live install untouched^)
  )
) else (
  echo   Target : resources\app.asar under the DeepSeek Harness dir
  echo   Backup : app.asar.whale-backup  ^(kept; used by --rollback^)
)
echo.

if "%DRY%"=="1" goto :rehearse
goto :guarded

:rehearse
if "%MODE%"=="rollback" goto :dryRollback
echo Rehearsing the install now: no Harness exit needed, live install untouched ...
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
goto :done

:dryRollback
echo Rehearsing the rollback now: no Harness exit needed, live install untouched ...
echo.
node "vendor\whale\install.mjs" --rollback --to "state\cmp\rollback-rehearsal.asar"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Rollback rehearsal passed: the backup restores byte for byte.
  echo      The live app.asar was NOT modified. To really roll back, quit Harness
  echo      completely and run:  install-whale.cmd /rollback
) else (
  echo [FAIL] exit code %RC%  -  the backup could NOT be restored.
  echo        Fix this BEFORE you need a rollback. See the output above.
)
goto :done

:guarded
rem --- guard: app.asar is memory-mapped while Harness runs ---------------
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" /NH /FO CSV 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo [STOP] DeepSeek Harness is still running.
  echo.
  echo   Quit it COMPLETELY first: right-click the tray icon -^> Quit.
  echo   Closing the window is NOT enough - it keeps running in the tray.
  echo.
  echo   Then run this script again.
  if "%MODE%"=="rollback" (
    echo   Want to check the backup without quitting?  run:  install-whale.cmd /rollback /dry
  ) else (
    echo   Want to check the artifact without quitting?  run:  install-whale.cmd /dry
  )
  set "RC=2"
  goto :done
)

if "%MODE%"=="rollback" goto :realRollback
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
  echo   Rollback: install-whale.cmd /rollback
  echo   ^(or: node vendor\whale\install.mjs --rollback^)
)
goto :done

:realRollback
echo Harness is not running. Restoring from the backup ...
echo.
node "vendor\whale\install.mjs" --rollback
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Rolled back. Start DeepSeek Harness to run the original interface again.
  echo      The changes are not lost - the declarations and materials are in the repo.
  echo.
  echo   Two things after a rollback:
  echo    1. Refresh the baseline, or upgrade reports the archive as modified:
  echo         node src\cli.mjs baseline write
  echo    2. To install the patched archive again later:
  echo         quit Harness, then run  install-whale.cmd
) else (
  echo [FAIL] exit code %RC%  -  see the output above.
  echo.
  echo   Nothing was changed if the message says the backup is missing.
  echo   The backup must exist:  resources\app.asar.whale-backup
)
goto :done

:done
echo.
if "%NOPAUSE%"=="1" goto :nopause
pause

:nopause
endlocal & exit /b %RC%
