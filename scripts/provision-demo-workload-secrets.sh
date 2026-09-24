#!/usr/bin/env bash
set -euo pipefail
umask 077

api_image="${1:?usage: provision-demo-workload-secrets.sh <api-image>}"
namespace="open-triage"
legacy_secret="open-triage-database"
migration_secret="open-triage-migration-database"
bootstrap_secret="open-triage-workload-credential-bootstrap"
workload_secrets=(
  open-triage-api-database
  open-triage-analytics-projector-database
  open-triage-analytics-health-database
  open-triage-retention-database
  open-triage-operational-audit-database
)

secret_exists() {
  kubectl get secret "$1" --namespace "$namespace" >/dev/null 2>&1
}

secret_value() {
  kubectl get secret "$1" --namespace "$namespace" \
    --output "jsonpath={.data.$2}" | base64 --decode
}

require_value() {
  local value="$1"
  local name="$2"
  [[ -n "$value" ]] || { echo "Required legacy key $name is missing" >&2; return 1; }
}

database_url_for_login() {
  DATABASE_URL_INPUT="$1" LOGIN_INPUT="$2" PASSWORD_INPUT="$3" \
    node scripts/workload-database-url.mjs
}

normalize_workload_secret() {
  local secret="$1"
  local current_url normalized_url encoded_url
  current_url="$(secret_value "$secret" DATABASE_URL)"
  require_value "$current_url" "$secret.DATABASE_URL"
  normalized_url="$(DATABASE_URL_INPUT="$legacy_database_url" \
    WORKLOAD_DATABASE_URL_INPUT="$current_url" \
    node scripts/workload-database-url.mjs --normalize)"
  if [[ "$normalized_url" != "$current_url" ]]; then
    encoded_url="$(printf '%s' "$normalized_url" | base64 | tr -d '\n')"
    kubectl patch secret "$secret" --namespace "$namespace" --type merge \
      --patch "{\"data\":{\"DATABASE_URL\":\"$encoded_url\"}}" >/dev/null
    echo "Repaired database routing for $secret"
  fi
}

if ! secret_exists "$legacy_secret"; then
  echo "Legacy Secret $legacy_secret is required for the one-time credential transition" >&2
  exit 1
fi

legacy_database_url="$(secret_value "$legacy_secret" DATABASE_URL)"
require_value "$legacy_database_url" DATABASE_URL

if ! secret_exists "$migration_secret"; then
  echo "Migration Secret $migration_secret must be created by the database preparation phase" >&2
  exit 1
fi

existing_workload_secrets=0
for secret in "${workload_secrets[@]}"; do
  secret_exists "$secret" && existing_workload_secrets=$((existing_workload_secrets + 1))
done
if [[ "$existing_workload_secrets" -eq "${#workload_secrets[@]}" ]]; then
  for secret in "${workload_secrets[@]}"; do
    normalize_workload_secret "$secret"
  done
  echo "Isolated demo workload Secrets already exist; preserved their credentials"
  exit 0
fi
if [[ "$existing_workload_secrets" -gt 0 ]] && ! secret_exists "$bootstrap_secret"; then
  echo "Refusing to overwrite a partial credential transition without its bootstrap Secret" >&2
  exit 1
fi

image_tag="${api_image##*:}"
job_suffix="${image_tag:0:12}"
if ! secret_exists "$bootstrap_secret"; then
  login_suffix="$(openssl rand -hex 6)"
  kubectl create secret generic "$bootstrap_secret" --namespace "$namespace" \
    --from-literal=API_DATABASE_LOGIN="open_triage_demo_api_$login_suffix" \
    --from-literal=API_DATABASE_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')" \
    --from-literal=ANALYTICS_PROJECTOR_DATABASE_LOGIN="open_triage_demo_analytics_projector_$login_suffix" \
    --from-literal=ANALYTICS_PROJECTOR_DATABASE_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')" \
    --from-literal=ANALYTICS_HEALTH_DATABASE_LOGIN="open_triage_demo_analytics_health_$login_suffix" \
    --from-literal=ANALYTICS_HEALTH_DATABASE_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')" \
    --from-literal=RETENTION_DATABASE_LOGIN="open_triage_demo_retention_$login_suffix" \
    --from-literal=RETENTION_DATABASE_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')" \
    --from-literal=OPERATIONAL_AUDIT_DATABASE_LOGIN="open_triage_demo_operational_audit_$login_suffix" \
    --from-literal=OPERATIONAL_AUDIT_DATABASE_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')" \
    --dry-run=client --output yaml | kubectl apply --filename -
fi

provision_job="open-triage-workload-logins-$job_suffix"
kubectl delete job "$provision_job" --namespace "$namespace" --ignore-not-found --wait=true
kubectl apply --filename - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: $provision_job
  namespace: $namespace
spec:
  ttlSecondsAfterFinished: 600
  backoffLimit: 0
  activeDeadlineSeconds: 300
  template:
    spec:
      imagePullSecrets:
        - name: ghcr-pull
      restartPolicy: Never
      containers:
        - name: provision
          image: $api_image
          command: ["npm", "run", "provision:workload-logins", "-w", "@open-triage/database"]
          envFrom:
            - secretRef:
                name: $migration_secret
            - secretRef:
                name: $bootstrap_secret
EOF
if ! kubectl wait --namespace "$namespace" --for=condition=complete \
  "job/$provision_job" --timeout=5m; then
  kubectl describe job "$provision_job" --namespace "$namespace" || true
  kubectl logs "job/$provision_job" --namespace "$namespace" --all-containers=true || true
  exit 1
fi
kubectl logs "job/$provision_job" --namespace "$namespace" --all-containers=true

api_login="$(secret_value "$bootstrap_secret" API_DATABASE_LOGIN)"
api_password="$(secret_value "$bootstrap_secret" API_DATABASE_PASSWORD)"
projector_login="$(secret_value "$bootstrap_secret" ANALYTICS_PROJECTOR_DATABASE_LOGIN)"
projector_password="$(secret_value "$bootstrap_secret" ANALYTICS_PROJECTOR_DATABASE_PASSWORD)"
health_login="$(secret_value "$bootstrap_secret" ANALYTICS_HEALTH_DATABASE_LOGIN)"
health_password="$(secret_value "$bootstrap_secret" ANALYTICS_HEALTH_DATABASE_PASSWORD)"
retention_login="$(secret_value "$bootstrap_secret" RETENTION_DATABASE_LOGIN)"
retention_password="$(secret_value "$bootstrap_secret" RETENTION_DATABASE_PASSWORD)"
audit_login="$(secret_value "$bootstrap_secret" OPERATIONAL_AUDIT_DATABASE_LOGIN)"
audit_password="$(secret_value "$bootstrap_secret" OPERATIONAL_AUDIT_DATABASE_PASSWORD)"

api_database_url="$(database_url_for_login "$legacy_database_url" "$api_login" "$api_password")"
projector_database_url="$(database_url_for_login "$legacy_database_url" "$projector_login" "$projector_password")"
health_database_url="$(database_url_for_login "$legacy_database_url" "$health_login" "$health_password")"
retention_database_url="$(database_url_for_login "$legacy_database_url" "$retention_login" "$retention_password")"
audit_database_url="$(database_url_for_login "$legacy_database_url" "$audit_login" "$audit_password")"

supabase_url="$(secret_value "$legacy_secret" SUPABASE_URL)"
supabase_secret_key="$(secret_value "$legacy_secret" SUPABASE_SECRET_KEY)"
patient_key_installation_id="$(secret_value "$legacy_secret" PATIENT_KEY_INSTALLATION_ID)"
patient_key_version="$(secret_value "$legacy_secret" PATIENT_KEY_VERSION)"
patient_key_secret="$(secret_value "$legacy_secret" PATIENT_KEY_SECRET_BASE64)"
auth_rate_limit_secret="$(secret_value "$legacy_secret" AUTH_RATE_LIMIT_SECRET_BASE64)"
offline_recovery_key_version="$(secret_value "$legacy_secret" OFFLINE_RECOVERY_KEY_VERSION)"
offline_recovery_secret="$(secret_value "$legacy_secret" OFFLINE_RECOVERY_SECRET_BASE64)"
patient_key_version="${patient_key_version:-1}"
offline_recovery_key_version="${offline_recovery_key_version:-1}"
auth_rate_limit_secret="${auth_rate_limit_secret:-$(openssl rand -base64 32 | tr -d '\n')}"
offline_recovery_secret="${offline_recovery_secret:-$(openssl rand -base64 32 | tr -d '\n')}"
require_value "$supabase_url" SUPABASE_URL
require_value "$supabase_secret_key" SUPABASE_SECRET_KEY
require_value "$patient_key_installation_id" PATIENT_KEY_INSTALLATION_ID
require_value "$patient_key_secret" PATIENT_KEY_SECRET_BASE64

kubectl create secret generic open-triage-api-database --namespace "$namespace" \
  --from-literal=DATABASE_URL="$api_database_url" \
  --from-literal=SUPABASE_URL="$supabase_url" \
  --from-literal=SUPABASE_SECRET_KEY="$supabase_secret_key" \
  --from-literal=PATIENT_KEY_INSTALLATION_ID="$patient_key_installation_id" \
  --from-literal=PATIENT_KEY_VERSION="$patient_key_version" \
  --from-literal=PATIENT_KEY_SECRET_BASE64="$patient_key_secret" \
  --from-literal=AUTH_RATE_LIMIT_SECRET_BASE64="$auth_rate_limit_secret" \
  --from-literal=OFFLINE_RECOVERY_KEY_VERSION="$offline_recovery_key_version" \
  --from-literal=OFFLINE_RECOVERY_SECRET_BASE64="$offline_recovery_secret" \
  --dry-run=client --output yaml | kubectl apply --filename -
kubectl create secret generic open-triage-analytics-projector-database --namespace "$namespace" \
  --from-literal=DATABASE_URL="$projector_database_url" --dry-run=client --output yaml |
  kubectl apply --filename -
kubectl create secret generic open-triage-analytics-health-database --namespace "$namespace" \
  --from-literal=DATABASE_URL="$health_database_url" --dry-run=client --output yaml |
  kubectl apply --filename -
kubectl create secret generic open-triage-retention-database --namespace "$namespace" \
  --from-literal=DATABASE_URL="$retention_database_url" --dry-run=client --output yaml |
  kubectl apply --filename -
kubectl create secret generic open-triage-operational-audit-database --namespace "$namespace" \
  --from-literal=DATABASE_URL="$audit_database_url" --dry-run=client --output yaml |
  kubectl apply --filename -

kubectl delete secret "$bootstrap_secret" --namespace "$namespace" --ignore-not-found
echo "Provisioned isolated demo workload credentials without replacing existing key material"
