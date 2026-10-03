@echo off
cd /d "%~dp0"
title Dukkan WhatsApp worker
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org then run this file again.
  pause
  exit /b
)
if not exist .env (
  echo Copy .env.example to .env and fill SUPABASE_URL and SUPABASE_SERVICE_KEY first.
  pause
  exit /b
)
if not exist node_modules (
  echo Installing libraries, first time only. This can take a few minutes...
  call npm install
)
echo.
echo If a QR code appears, scan it with the platform phone: WhatsApp - Linked devices.
echo Keep this window open. Closing it stops the messages.
echo.
node worker.js
pause
