#!/bin/bash
set -euo pipefail

workspace_folder="${containerWorkspaceFolder:-/workspaces/ActiveBits}"

echo "🛠️ Running ActiveBits post-create setup..."

if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$workspace_folder"; then
  git config --global --add safe.directory "$workspace_folder"
fi

npm install --workspaces --include-workspace-root
