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

for pid in $PIDS; do
  if kill -0 "$pid" 2>/dev/null; then
    wait "$pid" 2>/dev/null || true
  fi
done

echo "Server stopped."
