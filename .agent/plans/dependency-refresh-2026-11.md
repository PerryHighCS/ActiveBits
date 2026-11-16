# Dependency refresh (November 2026)

## Goal

Refresh compatible npm dependencies on a dedicated branch while preserving application behavior.

## Checklist

- [x] Confirm a clean tree, read project guidance, refresh `origin/main`, and create a non-main branch.
- [x] Inventory outdated packages and audit all four lockfiles.
- [x] Update compatible direct ranges and refresh root and standalone workspace lockfiles.
- [x] Update the Node LTS and npm pins, Node types, devcontainer feature versions, CI install path, and deployment requirement.
- [x] Run the required tests, typecheck, lint, build, and relevant browser checks; resolve regressions.
- [x] Record durable findings and any remaining update constraints.

## Scope and constraints

This is a cross-workspace dependency and toolchain update. Keep application behavior unchanged. Move to the current Node 26 LTS and npm 12, keep Brython on the 3.14 line until the MobCode browser runner supports a newer release, and check peer dependencies before moving across other major versions. The root and standalone workspace lockfiles must remain consistent with their manifests.
