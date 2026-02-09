#!/usr/bin/env bash
set -euo pipefail

violations="$(rg --files client server activities scripts -g '*.js' -g '*.jsx' || true)"

if [ -n "${violations}" ]; then
  echo "Found unexpected .js/.jsx source files in migration scope:"
  echo "${violations}"
  exit 1
fi

echo "Source extension guard passed (no .js/.jsx files in migration scope)."
