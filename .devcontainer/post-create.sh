#!/bin/bash
set -euo pipefail

workspace_folder="${1:-.}"

echo "🛠️ Running ActiveBits post-create setup..."

if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$workspace_folder"; then
  git config --global --add safe.directory "$workspace_folder"
fi

# Enforce pinned npm version before installing dependencies.
cd "$workspace_folder" || exit 1
bash .devcontainer/setup-dev.sh --no-wait-valkey

npm install --workspaces --include-workspace-root

if [[ "${ACTIVEBITS_SKIP_PLAYWRIGHT_WEBKIT_INSTALL:-0}" == "1" ]]; then
  echo "ℹ️ Skipping Playwright WebKit install (ACTIVEBITS_SKIP_PLAYWRIGHT_WEBKIT_INSTALL=1)."
else
  echo "🌐 Installing Playwright WebKit browser and host dependencies..."
  npx playwright install --with-deps webkit
fi
