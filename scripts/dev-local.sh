#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env.local"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  exit 1
fi

for port in 3000 3001; do
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use; stop the stale local server before starting." >&2
    exit 1
  fi
done

cd "$repo_root"
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

database_name="$(node -e 'console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))')"
build_sha="$(git rev-parse --short HEAD 2>/dev/null || true)"
export OPEN_TRIAGE_BUILD_SHA="${build_sha:-unknown}"
echo "Starting $repo_root at ${OPEN_TRIAGE_BUILD_SHA}; database=$database_name"

(npm run dev -w @open-triage/api) &
api_pid=$!
(env -u PORT npm run dev -w @open-triage/web) &
web_pid=$!

cleanup() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait -n "$api_pid" "$web_pid"
