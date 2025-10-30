#!/bin/bash

# Kill any existing processes on port 8800
lsof -ti:8800 | xargs kill -9 2>/dev/null

# Initial build
echo "🔨 Building frontend..."
bun run dev:build

# Start watchers in background
echo "👀 Starting CSS watcher..."
bunx tailwindcss -i src/styles/globals.css -o public/assets/styles.css --watch &
CSS_PID=$!

echo "👀 Starting JS watcher..."
bun build src/main.tsx --outdir public/assets --target browser --sourcemap=external --watch &
JS_PID=$!

# Start server
echo "🚀 Starting server..."
bun run --hot server/index.ts &
SERVER_PID=$!

# Cleanup function
cleanup() {
  echo ""
  echo "🛑 Stopping all processes..."
  kill $CSS_PID $JS_PID $SERVER_PID 2>/dev/null
  exit 0
}

# Register cleanup on script exit
trap cleanup SIGINT SIGTERM

# Wait for all background processes
wait
