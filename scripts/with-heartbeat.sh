#!/usr/bin/env sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: sh scripts/with-heartbeat.sh <label> <command> [args...]" >&2
  exit 2
fi

label="$1"
shift

"$@" &
pid=$!

interval="${HEARTBEAT_SECONDS:-20}"

while kill -0 "$pid" 2>/dev/null; do
  printf '[heartbeat] %s running\n' "$label"
  sleep "$interval"
done

wait "$pid"
