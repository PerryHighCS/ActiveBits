#!/bin/bash
set -e

echo "🔧 Setting up ActiveBits development environment..."

# Fallback: some devcontainer feature combinations can skip installRg.
if ! command -v rg >/dev/null 2>&1; then
  echo "⏳ ripgrep (rg) not found; installing..."
  if [ "$(id -u)" -eq 0 ]; then
    apt-get update && apt-get install -y ripgrep
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y ripgrep
  else
    echo "⚠️ Unable to install ripgrep automatically (no root/sudo)."
  fi
fi

# If redis-cli is available, wait for Valkey; otherwise skip gracefully
if command -v redis-cli >/dev/null 2>&1; then
  echo "⏳ Waiting for Valkey to be ready..."
  until redis-cli -h valkey ping 2>/dev/null | grep -q PONG; do
    echo "Valkey is unavailable - sleeping"
    sleep 1
  done
  echo "✅ Valkey is ready!"
else
  echo "ℹ️ redis-cli not found; skipping Valkey readiness check."
fi

# Test connection (only if redis-cli is present)
if command -v redis-cli >/dev/null 2>&1; then
  echo "🧪 Testing Valkey connection..."
  redis-cli -h valkey ping || true
fi

echo "✨ Development environment is ready!"
echo ""
echo "Environment variables:"
if [ -n "$VALKEY_URL" ]; then
  # Avoid printing credentials; only show scheme and host
  parsed_host="$(echo "$VALKEY_URL" | sed -E 's#(rediss?://)([^:/@]+(:[^@]+)?@)?([^:/]+)(:.*)?#\1****@'\''\4'\''#')"
  if [ "$parsed_host" = "$VALKEY_URL" ]; then
    parsed_host="(hidden)"
  fi
  echo "  VALKEY_URL=${parsed_host}"
fi
echo ""
echo "To test Valkey manually (if installed), run:"
echo "  redis-cli -h valkey"
