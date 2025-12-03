#!/usr/bin/env bash
set -euo pipefail

PATTERN="node .*server/server.js"
PIDS=$(pgrep -f "$PATTERN" || true)

if [[ -z "$PIDS" ]]; then
  echo "No ActiveBits server process found."
  exit 0
fi

echo "Stopping server PIDs: $PIDS"
kill $PIDS

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
