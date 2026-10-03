#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Compatibility entry point; environment loading and supervision live in Node.
exec node "$repo_root/scripts/dev-local.mjs" "$@"
