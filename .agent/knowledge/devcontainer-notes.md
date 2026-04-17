# Devcontainer Notes

Track durable local-development and devcontainer behavior that future contributors should reuse.

## Entry Template

- Date:
- Change:
- Risk:
- Evidence:
- Follow-up action:
- Owner:

## Entries

- Date: 2026-04-17
- Change: GitHub CLI setup in `.devcontainer/setup-dev.sh` downloads the APT keyring to a temporary file first, then installs it with `install -m 0644` instead of using `curl | tee`.
- Risk: The install path is slightly more verbose, but failed key downloads are now reported at the download step instead of being masked by a successful `tee` process.
- Evidence: `.devcontainer/setup-dev.sh`; `bash -n .devcontainer/setup-dev.sh`; stubbed dry-runs of successful `gh` setup and failed keyring download paths.
- Follow-up action: Prefer temp-file plus privileged `install` for future devcontainer setup writes that need accurate command-failure handling without relying on global `pipefail`.
- Owner: Codex

- Date: 2026-03-21
- Change: Hardened privileged bootstrap sudo behavior: `.devcontainer/post-start-bootstrap.sh` now grants `(ALL) NOPASSWD: ALL` only when explicitly enabled via `ACTIVEBITS_ENABLE_BROAD_SUDO=1` or marker file `.devcontainer/privileged/enable-broad-sudo.local`. Without opt-in, no broad sudo rule is created, and any stale broad rule is removed. When enabling, the script now writes to a root-owned `0440` temporary drop-in under `/etc/sudoers.d`, validates with `visudo -cf`, and only then moves it into place.
- Risk: Nested sandbox tooling that genuinely requires arbitrary-user launches may fail until opt-in is set; this is an intentional secure default.
- Evidence: `.devcontainer/post-start-bootstrap.sh`
- Follow-up action: If a durable minimal command allowlist for sandbox tooling is identified, replace broad sudo opt-in with that command allowlist.
- Owner: Codex

- Date: 2026-03-21
- Change: Moved host-sensitive bootstrap out of `postCreateCommand`. `.devcontainer/post-create.sh` no longer edits sudoers or changes `.git` ownership. New `.devcontainer/post-start-bootstrap.sh` now handles `.git` ownership alignment for both profiles, and only applies `(ALL) NOPASSWD: ALL` when the privileged profile passes `--privileged` to post-start bootstrap.
- Risk: Post-start runs after attach, so first-start UX can show temporary ownership friction until post-start finishes; logic remains idempotent and retries on each start.
- Evidence: `.devcontainer/post-create.sh`; `.devcontainer/post-start-bootstrap.sh`; `.devcontainer/devcontainer.json`; `.devcontainer/privileged/devcontainer.json`
- Follow-up action: Keep pre-attach `postCreateCommand` focused on workspace-safe setup only; route privileged or host-specific remediation through post-start scripts.
- Owner: Codex

- Date: 2026-03-20
- Change: Keep `postCreateCommand` lightweight; use only for workspace-path-specific setup. ActiveBits now uses `.devcontainer/post-create.sh` only for `safe.directory` registration plus workspace dependency install, while `.devcontainer/setup-dev.sh` remains a `postStartCommand` concern. Note: `safe.directory` is registered via `git config --global` (persistent across all workspaces) but targets this specific workspace path.
- Risk: Broader bootstrap in `postCreateCommand` can hard-fail container creation on host-specific shell or service-readiness issues, even when the same work is already retried more safely after container start.
- Evidence: `.devcontainer/devcontainer.json`; `.devcontainer/privileged/devcontainer.json`; `.devcontainer/post-create.sh`; `.devcontainer/setup-dev.sh`
- Follow-up action: Keep future privileged, service-readiness, or host-sensitive bootstrap logic out of `postCreateCommand` unless it is strictly required before first attach.
- Owner: Codex
