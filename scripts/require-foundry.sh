#!/usr/bin/env bash
# Sourced by the scripts that run forge: contracts/foundry.toml sets `network = "monad"` (MIP-8 gas), which needs
# Foundry 1.8 or later. Stops with the fix when an older forge comes first on PATH (Homebrew ships 1.7).
forge_version=$(forge --version 2>/dev/null | sed -n 's/^forge Version: \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')
read -r forge_major forge_minor <<< "${forge_version:-0 0}"
if [ "$forge_major" -lt 1 ] || { [ "$forge_major" -eq 1 ] && [ "$forge_minor" -lt 8 ]; }; then
  echo "forge $(command -v forge) is ${forge_major}.${forge_minor}; Shield needs Foundry 1.8 or later." >&2
  echo "Fix: run foundryup, then put ~/.foundry/bin first on PATH (export PATH=\"\$HOME/.foundry/bin:\$PATH\")." >&2
  exit 1
fi
