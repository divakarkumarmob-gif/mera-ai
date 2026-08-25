@echo off
title FRIDAY AI - Live Assistant Launcher
color 0B

echo ===================================================
echo           FRIDAY AI ASSISTANT LAUNCHER
echo ===================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Check .env file
if not exist .env (
    echo [INFO] .env file not found. Creating from .env.example...
    copy .env.example .env >nul
    echo [NOTICE] Please open .env and add your GEMINI_API_KEY / FAST2SMS_API_KEY if needed.
    echo.
)

:: 3. Check dependencies
if not exist node_modules (
    echo [INFO] Installing required dependencies...
    npm install --omit=dev
    echo.
)

:: 4. Start Server
echo [SUCCESS] Launching FRIDAY AI Assistant on http://localhost:3000 ...
echo [INFO] Press Ctrl+C anytime to stop the server.
echo.

start http://localhost:3000
node dist/server.cjs

pause
