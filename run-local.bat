@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Error: Node.js is not installed or is not available in PATH.
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Error: npm is not available in PATH.
  goto fail
)

if not exist "node_modules\wrangler" (
  echo Installing project dependencies...
  call npm.cmd install
  if errorlevel 1 goto fail
)


echo Applying local D1 migrations...
call npm.cmd run db:local
if errorlevel 1 goto fail

echo Starting the local development server...
echo Press Ctrl+C to stop the server.
call npm.cmd run dev
if errorlevel 1 goto fail

exit /b 0

:fail
echo.
echo Local startup failed. Check the error above and try again.
pause
exit /b 1