#!/bin/bash
set -euo pipefail

workspace_folder="${1:-.}"

# --privileged: opt-in flag passed only by the privileged devcontainer variant.
# Enables broad (ALL) sudo expansion needed by nested sandbox tooling.
privileged_mode=0
for _arg in "${@:2}"; do
  [[ "$_arg" == "--privileged" ]] && privileged_mode=1
done

echo "🛠️ Running ActiveBits post-create setup..."

# In the privileged devcontainer, extend NOPASSWD sudo to all target users so
# nested sandbox tooling can switch identities at will.  In the standard
# devcontainer this expansion is unnecessary: common-utils already grants
# NOPASSWD for root, which is sufficient for the git-ownership fix below.
if [[ "$privileged_mode" -eq 1 ]] && command -v sudo >/dev/null 2>&1 && id -un | grep -Eq '^(node|vscode)$'; then
  sudoers_file="/etc/sudoers.d/$(id -un)-all-users"
  if [ ! -f "$sudoers_file" ]; then
    echo "$(id -un) ALL=(ALL) NOPASSWD: ALL" | sudo SUDO_EDITOR='tee' visudo -f "$sudoers_file" >/dev/null || \
      echo "⚠️ Could not extend sudo rules for $(id -un)."
  fi
fi

# Some WSL/devcontainer mounts keep repo files owned by a different UID.
# Align .git ownership with the active user to avoid config.lock chmod failures.
git_dir="$workspace_folder/.git"
if [ -d "$git_dir" ]; then
  current_uid="$(id -u)"
  current_gid="$(id -g)"
  git_uid="$(stat -c '%u' "$git_dir" 2>/dev/null || echo "$current_uid")"
  git_gid="$(stat -c '%g' "$git_dir" 2>/dev/null || echo "$current_gid")"

  if [ "$git_uid" != "$current_uid" ] || [ "$git_gid" != "$current_gid" ]; then
    echo "ℹ️ Adjusting .git ownership for current user..."
    if command -v sudo >/dev/null 2>&1; then
      sudo chown -R "$current_uid:$current_gid" "$git_dir" || \
        echo "⚠️ Could not update .git ownership automatically."
    else
      echo "⚠️ sudo unavailable; skipping .git ownership alignment."
    fi
  fi
fi

if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$workspace_folder"; then
  git config --global --add safe.directory "$workspace_folder"
fi

# Enforce pinned npm version before installing dependencies.
cd "$workspace_folder" || exit 1
bash .devcontainer/setup-dev.sh --no-wait-valkey

npm install --workspaces --include-workspace-root
