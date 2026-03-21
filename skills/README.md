# Shared Skills

This folder contains shared agent skills vendored into ActiveBits.

## Current Skill

- `syncdeck/` is a git subtree mirror of `https://github.com/PerryHighCS/syncdeck-agent-skills.git`

## Workflow

- Edit the vendored files in `skills/syncdeck/`
- Commit changes in this repo as usual
- Push updates back upstream with:

```bash
git subtree push --prefix=skills/syncdeck syncdeck-agent-skills main
```

## Important

- Treat `skills/syncdeck/` as the canonical local copy
- Do not reintroduce a parallel `skills/slidedeck/` source folder unless the workflow is intentionally changed
