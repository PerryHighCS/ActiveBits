#!/bin/bash
set -e

echo "🔧 Setting up ActiveBits development environment..."

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
  masked="$(echo "$VALKEY_URL" | sed -E 's#(redis://[^:@]*:)[^@]+@#\1****@#')"
  if [ "$masked" = "$VALKEY_URL" ]; then
    masked="$(echo "$VALKEY_URL" | sed -E 's#(redis://):[^@]+@#\1:****@#')"
  fi
  echo "  VALKEY_URL=${masked}"
fi
echo ""
echo "To test Valkey manually (if installed), run:"
echo "  redis-cli -h valkey"
