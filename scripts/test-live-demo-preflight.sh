#!/usr/bin/env bash
set -euo pipefail

namespace="open-triage-validation"
api_image="${1:?usage: test-live-demo-preflight.sh API_IMAGE SOURCE_COMMIT}"
source_commit="${2:?usage: test-live-demo-preflight.sh API_IMAGE SOURCE_COMMIT}"
requirements="deploy/kubernetes/validation/preflight-secrets.json"
temporary_directory="$(mktemp -d)"
database_forward_pid=""

cleanup() {
  [[ -z "$database_forward_pid" ]] || kill "$database_forward_pid" 2>/dev/null || true
  [[ -z "$database_forward_pid" ]] || wait "$database_forward_pid" 2>/dev/null || true
  kubectl delete job open-triage-preflight-conflict --namespace "$namespace" \
    --ignore-not-found --wait=false >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT

kubectl port-forward --namespace "$namespace" service/postgres 35432:5432 \
  > "$temporary_directory/postgres-port-forward.log" 2>&1 &
database_forward_pid=$!
for _ in {1..30}; do
  if PGCONNECT_TIMEOUT=1 psql \
    "postgresql://postgres:postgres@127.0.0.1:35432/open_triage_validation" \
    -X --no-psqlrc -Atqc 'select 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
export PREFLIGHT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:35432/open_triage_validation"

preflight() {
  local output="$1"
  shift
  node scripts/live-demo-preflight.mjs run \
    --namespace "$namespace" \
    --sha "$source_commit" \
    --output "$output" \
    --requirements "$requirements" \
    --database-secret open-triage-migration-database \
    --registry-mode local \
    --registry-image "$api_image" \
    "$@"
}

require_status() {
  local output="$1"
  local expected="$2"
  EXPECTED_STATUS="$expected" node -e '
    const summary = require(process.argv[1]);
    if (summary.status !== process.env.EXPECTED_STATUS) process.exit(1);
  ' "$(realpath "$output")"
}

success_summary="$temporary_directory/success.json"
preflight "$success_summary"
require_status "$success_summary" pass

missing_summary="$temporary_directory/missing-secret.json"
if preflight "$missing_summary" --required-secret preflight-missing-secret:REQUIRED_KEY; then
  echo "Missing Secret fixture unexpectedly passed" >&2
  exit 1
fi
require_status "$missing_summary" fail

forbidden_summary="$temporary_directory/forbidden.json"
if PREFLIGHT_KUBECTL_AS="system:serviceaccount:$namespace:preflight-forbidden" \
  preflight "$forbidden_summary"; then
  echo "Forbidden RBAC fixture unexpectedly passed" >&2
  exit 1
fi
require_status "$forbidden_summary" fail

capacity_summary="$temporary_directory/insufficient-capacity.json"
if PREFLIGHT_REQUIRED_CPU_M=999999999 preflight "$capacity_summary"; then
  echo "Insufficient capacity fixture unexpectedly passed" >&2
  exit 1
fi
require_status "$capacity_summary" fail

kubectl create job open-triage-preflight-conflict --namespace "$namespace" \
  --image="$api_image" -- node -e 'setTimeout(() => {}, 120000)'
kubectl label job open-triage-preflight-conflict --namespace "$namespace" \
  app.kubernetes.io/instance=open-triage
kubectl wait --namespace "$namespace" --for=jsonpath='{.status.active}'=1 \
  job/open-triage-preflight-conflict --timeout=60s
conflict_summary="$temporary_directory/conflicting-job.json"
if preflight "$conflict_summary"; then
  echo "Conflicting Job fixture unexpectedly passed" >&2
  exit 1
fi
require_status "$conflict_summary" fail

echo "Live demo preflight ephemeral scenarios passed"
