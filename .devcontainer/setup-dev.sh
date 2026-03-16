#!/bin/bash
set -e

echo "🔧 Setting up ActiveBits development environment..."

desired_npm_version="11.11.1"

run_with_available_privilege() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    return 1
  fi
}

if command -v npm >/dev/null 2>&1; then
  current_npm_version="$(npm --version || true)"
  if [ "$current_npm_version" != "$desired_npm_version" ]; then
    echo "⏳ npm $desired_npm_version required; current version is ${current_npm_version:-missing}. Updating..."
    if ! npm install -g "npm@$desired_npm_version"; then
      echo "ℹ️ Retrying npm update with elevated permissions..."
      if ! run_with_available_privilege npm install -g "npm@$desired_npm_version"; then
        echo "⚠️ Unable to update npm automatically (no root/sudo). Continuing with npm ${current_npm_version:-missing}."
      fi
    fi

    updated_npm_version="$(npm --version || true)"
    if [ "$updated_npm_version" = "$desired_npm_version" ]; then
      echo "✅ npm is now $updated_npm_version"
    else
      echo "⚠️ npm update attempted but current version is ${updated_npm_version:-missing}."
    fi
  fi
fi

# Fallback: some devcontainer feature combinations can skip installRg.
if ! command -v rg >/dev/null 2>&1; then
  echo "⏳ ripgrep (rg) not found; installing..."
  if ! run_with_available_privilege apt-get update; then
    echo "⚠️ Unable to install ripgrep automatically (no root/sudo)."
  elif ! run_with_available_privilege apt-get install -y ripgrep; then
    echo "⚠️ Unable to install ripgrep automatically."
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
