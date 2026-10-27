# Security dependency refresh (October 2026)

## Goal

Move the Node 24 floor to the October security release and refresh compatible npm dependencies without changing application behavior.

## Checklist

- [x] Confirm a clean non-main branch, read project guidance, and capture the initial audit.
- [x] Raise the Node floor and refresh direct dependency ranges and all lockfiles.
- [x] Verify npm advisories, lockfile consistency, tests, typecheck, lint, build, and browser flows if affected.
- [x] Update deployment requirements and durable security notes.

## Scope and constraints

This is a cross-workspace toolchain and dependency update. Keep package updates within existing major versions and avoid application source changes unless verification exposes a compatibility issue. The npm lockfiles must remain usable both from the workspace root and from standalone workspace installs.

Brython 3.15.0 broke the MobCode Python runner; pin the compatible 3.14 line until the runner is updated and verified in a browser.
