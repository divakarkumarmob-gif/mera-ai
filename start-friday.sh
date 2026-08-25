#!/usr/bin/env bash

echo "==================================================="
echo "          FRIDAY AI ASSISTANT LAUNCHER"
echo "==================================================="
echo ""

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js (v18+) from https://nodejs.org"
    exit 1
fi

# 2. Check .env
if [ ! -f .env ]; then
    echo "[INFO] .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "[NOTICE] Please edit .env to add your GEMINI_API_KEY if needed."
    echo ""
fi

# 3. Check dependencies
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing production dependencies..."
    npm install --omit=dev
    echo ""
fi

# 4. Start Server
echo "[SUCCESS] Launching FRIDAY AI Assistant on http://localhost:3000 ..."
echo "[INFO] Press Ctrl+C anytime to stop."
echo ""

# Try opening default browser
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 &
elif command -v open &> /dev/null; then
    open http://localhost:3000 &
fi

node dist/server.cjs
