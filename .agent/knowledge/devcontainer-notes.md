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

- Date: 2026-03-20
- Change: Keep `postCreateCommand` lightweight; use only for workspace-path-specific setup. ActiveBits now uses `.devcontainer/post-create.sh` only for `safe.directory` registration plus workspace dependency install, while `.devcontainer/setup-dev.sh` remains a `postStartCommand` concern. Note: `safe.directory` is registered via `git config --global` (persistent across all workspaces) but targets this specific workspace path.
- Risk: Broader bootstrap in `postCreateCommand` can hard-fail container creation on host-specific shell or service-readiness issues, even when the same work is already retried more safely after container start.
- Evidence: `.devcontainer/devcontainer.json`; `.devcontainer/privileged/devcontainer.json`; `.devcontainer/post-create.sh`; `.devcontainer/setup-dev.sh`
- Follow-up action: Keep future privileged, service-readiness, or host-sensitive bootstrap logic out of `postCreateCommand` unless it is strictly required before first attach.
- Owner: Codex
