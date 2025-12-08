#!/usr/bin/env bash
set -euo pipefail

PIDS=""

# Kill processes matching the server pattern
PATTERN="node .*server/server.js"
PATTERN_PIDS=$(pgrep -f "$PATTERN" || true)
if [[ -n "$PATTERN_PIDS" ]]; then
  PIDS="$PIDS $PATTERN_PIDS"
fi

# Kill processes on port 3000 (backend server)
PORT_3000_PIDS=$(lsof -ti:3000 || true)
if [[ -n "$PORT_3000_PIDS" ]]; then
  PIDS="$PIDS $PORT_3000_PIDS"
fi

# Kill processes on port 5173 (Vite dev server)
PORT_5173_PIDS=$(lsof -ti:5173 || true)
if [[ -n "$PORT_5173_PIDS" ]]; then
  PIDS="$PIDS $PORT_5173_PIDS"
fi

# Deduplicate PIDs
PIDS=$(echo $PIDS | tr ' ' '\n' | sort -u | tr '\n' ' ')

if [[ -z "$PIDS" ]]; then
  echo "No ActiveBits server processes found."
  exit 0
fi

echo "Stopping server PIDs: $PIDS"
kill $PIDS 2>/dev/null || true

deadline=$((SECONDS + 10))
for pid in $PIDS; do
  while kill -0 "$pid" 2>/dev/null; do
    if (( SECONDS >= deadline )); then
      echo "PID $pid did not exit in time, sending SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
      break
    fi
    sleep 0.2
  done
done

echo "Server stopped."
