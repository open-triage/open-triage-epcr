#!/usr/bin/env bash
set -euo pipefail
umask 077

api_image="${1:?usage: prepare-demo-database.sh <api-image> <source-revision>}"
source_revision="${2:?usage: prepare-demo-database.sh <api-image> <source-revision>}"
namespace="open-triage"
legacy_secret="open-triage-database"
migration_secret="open-triage-migration-database"

[[ "$source_revision" =~ ^[0-9a-f]{40}$ ]] || { echo "Source revision must be a full commit SHA" >&2; exit 1; }
[[ "$api_image" == *":$source_revision" ]] || { echo "Preparation image must use the source revision tag" >&2; exit 1; }
: "${DEMO_DATABASE_PREPARE_MODE:?DEMO_DATABASE_PREPARE_MODE is required}"
: "${DEMO_DATABASE_EXPECTED_HOST:?DEMO_DATABASE_EXPECTED_HOST is required}"
: "${DEMO_DATABASE_PROJECT_REF:?DEMO_DATABASE_PROJECT_REF is required}"
[[ "$DEMO_DATABASE_EXPECTED_HOST" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || {
  echo "DEMO_DATABASE_EXPECTED_HOST is invalid" >&2
  exit 1
}
[[ "$DEMO_DATABASE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || {
  echo "DEMO_DATABASE_PROJECT_REF is invalid" >&2
  exit 1
}
[[ "$DEMO_DATABASE_PREPARE_MODE" == "migrate" || "$DEMO_DATABASE_PREPARE_MODE" == "reinitialize" ]] || {
  echo "DEMO_DATABASE_PREPARE_MODE must be migrate or reinitialize" >&2
  exit 1
}
if [[ "$DEMO_DATABASE_PREPARE_MODE" == "reinitialize" ]]; then
  [[ "${DEMO_DATABASE_RESET_CONFIRMATION:-}" == "reinitialize-open-triage-public-disposable-demo" ]] || {
    echo "The exact disposable-demo reset confirmation is required" >&2
    exit 1
  }
  reset_confirmation="$DEMO_DATABASE_RESET_CONFIRMATION"
else
  reset_confirmation=""
fi

if ! kubectl get secret "$migration_secret" --namespace "$namespace" >/dev/null 2>&1; then
  kubectl get secret "$legacy_secret" --namespace "$namespace" >/dev/null
  legacy_database_url="$(kubectl get secret "$legacy_secret" --namespace "$namespace" \
    --output jsonpath='{.data.DATABASE_URL}' | base64 --decode)"
  [[ -n "$legacy_database_url" ]] || { echo "Legacy DATABASE_URL is missing" >&2; exit 1; }
  kubectl create secret generic "$migration_secret" --namespace "$namespace" \
    --from-literal=DATABASE_URL="$legacy_database_url" --dry-run=client --output yaml |
    kubectl apply --filename - >/dev/null
fi

job="open-triage-database-prepare-${source_revision:0:12}"
kubectl delete job "$job" --namespace "$namespace" --ignore-not-found --wait=true >/dev/null
kubectl apply --filename - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: $job
  namespace: $namespace
  labels:
    app.kubernetes.io/name: open-triage
    app.kubernetes.io/component: database-preparation
    open-triage.org/source-revision: $source_revision
  annotations:
    open-triage.org/preparation-mode: $DEMO_DATABASE_PREPARE_MODE
spec:
  ttlSecondsAfterFinished: 86400
  backoffLimit: 0
  activeDeadlineSeconds: 900
  template:
    metadata:
      labels:
        app.kubernetes.io/name: open-triage
        app.kubernetes.io/component: database-preparation
    spec:
      imagePullSecrets:
        - name: ghcr-pull
      restartPolicy: Never
      containers:
        - name: prepare
          image: $api_image
          imagePullPolicy: IfNotPresent
          command: ["npm", "run", "prepare:demo:runtime", "-w", "@open-triage/database"]
          envFrom:
            - secretRef:
                name: $migration_secret
          env:
            - { name: DEMO_DATABASE_TARGET, value: open-triage-public-disposable-demo }
            - { name: DEMO_DATABASE_PREPARE_MODE, value: "$DEMO_DATABASE_PREPARE_MODE" }
            - { name: DEMO_DATABASE_EXPECTED_HOST, value: "$DEMO_DATABASE_EXPECTED_HOST" }
            - { name: DEMO_DATABASE_EXPECTED_NAME, value: postgres }
            - { name: DEMO_DATABASE_PROJECT_REF, value: "$DEMO_DATABASE_PROJECT_REF" }
            - { name: DEMO_DATABASE_RESET_CONFIRMATION, value: "$reset_confirmation" }
            - { name: SOURCE_REVISION, value: "$source_revision" }
            - { name: PGOPTIONS, value: "-c lock_timeout=45s -c statement_timeout=8min" }
          resources:
            requests: { cpu: 10m, memory: 64Mi }
            limits: { cpu: 500m, memory: 512Mi }
EOF

echo "Database preparation Job $job started for source revision $source_revision"
if ! kubectl wait --namespace "$namespace" --for=condition=complete "job/$job" --timeout=15m; then
  kubectl get job "$job" --namespace "$namespace" --output yaml || true
  kubectl logs "job/$job" --namespace "$namespace" --all-containers=true || true
  exit 1
fi
kubectl logs "job/$job" --namespace "$namespace" --all-containers=true
kubectl get job "$job" --namespace "$namespace" --output json
