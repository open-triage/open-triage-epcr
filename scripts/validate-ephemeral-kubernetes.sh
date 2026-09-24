#!/usr/bin/env bash
set -euo pipefail

namespace="open-triage-validation"
api_image="${1:?usage: validate-ephemeral-kubernetes.sh API_IMAGE WEB_IMAGE}"
web_image="${2:?usage: validate-ephemeral-kubernetes.sh API_IMAGE WEB_IMAGE}"
chart="deploy/helm/open-triage"
demo_values="$chart/demo-reference.values.yaml"
database_url="postgresql://postgres:postgres@postgres.${namespace}.svc.cluster.local:5432/open_triage_validation"

wait_for_jsonpath() {
  local resource="$1"
  local jsonpath="$2"
  local expected="$3"
  local attempts="${4:-60}"
  local value=""
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    value="$(kubectl get --namespace "$namespace" "$resource" --output "jsonpath=$jsonpath" 2>/dev/null || true)"
    [[ "$value" == "$expected" ]] && return 0
    sleep 2
  done
  echo "Timed out waiting for $resource $jsonpath to equal $expected (last value: $value)" >&2
  return 1
}

wait_for_event() {
  local object_name="$1"
  local pattern="$2"
  for _ in {1..60}; do
    if kubectl get events --namespace "$namespace" \
      --field-selector "involvedObject.name=$object_name" \
      --output jsonpath='{range .items[*]}{.reason}{" "}{.message}{"\n"}{end}' |
      grep --extended-regexp --quiet "$pattern"; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for $object_name event matching $pattern" >&2
  return 1
}

kubectl create namespace "$namespace"
kubectl apply --filename deploy/kubernetes/validation/postgres.yaml
kubectl rollout status deployment/postgres --namespace "$namespace" --timeout=3m

kubectl create secret generic open-triage-api-database --namespace "$namespace" \
  --from-literal="DATABASE_URL=$database_url" \
  --from-literal="SUPABASE_URL=http://supabase.invalid" \
  --from-literal="SUPABASE_SECRET_KEY=validation-only-secret" \
  --from-literal="PATIENT_KEY_INSTALLATION_ID=00000000-0000-4000-8000-000000000001" \
  --from-literal="PATIENT_KEY_VERSION=1" \
  --from-literal="PATIENT_KEY_SECRET_BASE64=MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=" \
  --from-literal="AUTH_RATE_LIMIT_SECRET_BASE64=MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjI=" \
  --from-literal="OFFLINE_RECOVERY_KEY_VERSION=1" \
  --from-literal="OFFLINE_RECOVERY_SECRET_BASE64=MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM="

for secret in \
  open-triage-migration-database \
  open-triage-analytics-projector-database \
  open-triage-analytics-health-database \
  open-triage-retention-database \
  open-triage-operational-audit-database; do
  kubectl create secret generic "$secret" --namespace "$namespace" \
    --from-literal="DATABASE_URL=$database_url"
done

api_repository="${api_image%:*}"
api_tag="${api_image##*:}"
web_repository="${web_image%:*}"
web_tag="${web_image##*:}"

kubectl apply --filename - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: open-triage-migration
  namespace: $namespace
  labels: { app.kubernetes.io/component: database-preparation }
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: $api_image
          imagePullPolicy: Never
          command: ["npm", "run", "migrate:runtime", "-w", "@open-triage/database"]
          envFrom:
            - secretRef: { name: open-triage-migration-database }
EOF
kubectl wait --namespace "$namespace" --for=condition=complete job/open-triage-migration --timeout=5m

helm upgrade --install open-triage "$chart" \
  --namespace "$namespace" \
  --values "$demo_values" \
  --set-json 'imagePullSecrets=[]' \
  --set-json 'ingress.tls=[]' \
  --set-string "api.image.repository=$api_repository" \
  --set-string "api.image.tag=$api_tag" \
  --set-string 'api.image.pullPolicy=Never' \
  --set-string "web.image.repository=$web_repository" \
  --set-string "web.image.tag=$web_tag" \
  --set-string 'web.image.pullPolicy=Never' \
  --set-string 'analytics.schedule=0 0 1 1 *' \
  --set-string 'analytics.healthSchedule=0 0 1 1 *' \
  --set-string 'syntheticExpiry.schedule=0 0 1 1 *' \
  --atomic \
  --wait \
  --wait-for-jobs \
  --timeout 5m

kubectl rollout status deployment/open-triage-api --namespace "$namespace" --timeout=3m
kubectl rollout status deployment/open-triage-web --namespace "$namespace" --timeout=3m

[[ "$(kubectl get deployment/open-triage-api --namespace "$namespace" --output jsonpath='{.spec.template.spec.containers[0].image}')" == "$api_image" ]]
[[ "$(kubectl get deployment/open-triage-web --namespace "$namespace" --output jsonpath='{.spec.template.spec.containers[0].image}')" == "$web_image" ]]
[[ "$(kubectl get pod --namespace "$namespace" --selector app.kubernetes.io/component=api --output jsonpath='{.items[0].status.containerStatuses[0].ready}')" == "true" ]]
[[ "$(kubectl get pod --namespace "$namespace" --selector app.kubernetes.io/component=web --output jsonpath='{.items[0].status.containerStatuses[0].ready}')" == "true" ]]

kubectl port-forward --namespace "$namespace" service/open-triage-api 3101:80 > /tmp/open-triage-api-port-forward.log 2>&1 &
api_forward_pid=$!
kubectl port-forward --namespace "$namespace" service/open-triage-web 3180:80 > /tmp/open-triage-web-port-forward.log 2>&1 &
web_forward_pid=$!
cleanup_forwards() {
  kill "$api_forward_pid" "$web_forward_pid" 2>/dev/null || true
  wait "$api_forward_pid" "$web_forward_pid" 2>/dev/null || true
}
trap cleanup_forwards EXIT
for _ in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3101/api/health >/dev/null &&
    curl --fail --silent http://127.0.0.1:3180/ >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:3101/api/health >/dev/null
curl --fail --silent http://127.0.0.1:3180/ >/dev/null
cleanup_forwards
trap - EXIT

for workload in analytics-projector analytics-health synthetic-expiry; do
  kubectl create job --namespace "$namespace" \
    --from="cronjob/open-triage-$workload" "validation-$workload"
  kubectl wait --namespace "$namespace" --for=condition=complete \
    "job/validation-$workload" --timeout=2m
done

fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT
sed \
  -e "s#OPEN_TRIAGE_API_CANDIDATE#$api_image#g" \
  -e "s#OPEN_TRIAGE_WEB_CANDIDATE#$web_image#g" \
  deploy/kubernetes/validation/negative-fixtures.yaml > "$fixture"
kubectl apply --filename "$fixture"

wait_for_jsonpath pod/negative-missing-secret-key \
  '{.status.containerStatuses[0].state.waiting.reason}' CreateContainerConfigError
wait_for_event negative-missing-secret-key 'Failed.*(REQUIRED_KEY|secret key)'

kubectl wait --namespace "$namespace" --for=condition=failed \
  job/negative-invalid-command --timeout=60s
wait_for_event negative-invalid-command 'Failed|BackoffLimitExceeded|DeadlineExceeded'

wait_for_jsonpath pod/negative-unschedulable '{.status.phase}' Pending
wait_for_event negative-unschedulable 'FailedScheduling.*Insufficient cpu'

wait_for_jsonpath pod/negative-failed-probe '{.status.phase}' Running
wait_for_event negative-failed-probe 'Unhealthy.*Readiness probe failed'
[[ "$(kubectl get pod/negative-failed-probe --namespace "$namespace" --output jsonpath='{.status.containerStatuses[0].ready}')" == "false" ]]

echo "Ephemeral Kubernetes validation passed for $api_image and $web_image"
