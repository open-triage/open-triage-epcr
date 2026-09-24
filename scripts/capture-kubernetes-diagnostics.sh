#!/usr/bin/env bash
set -euo pipefail

output_directory="${1:?usage: capture-kubernetes-diagnostics.sh OUTPUT_DIRECTORY}"
namespace="${2:-open-triage-validation}"
mkdir -p "$output_directory/logs" "$output_directory/pods"

redact() {
  sed --regexp-extended \
    -e 's#(postgres(ql)?://)[^[:space:]"'"']+#\1[REDACTED]#gI' \
    -e 's#((password|secret|token|private[_-]?key)[=:])[[:graph:]]+#\1[REDACTED]#gI'
}

if ! kubectl cluster-info > "$output_directory/cluster-info.txt" 2>&1; then
  echo "Kubernetes cluster was unavailable; no workload diagnostics could be collected." \
    > "$output_directory/unavailable.txt"
  exit 0
fi

kubectl get events --all-namespaces --sort-by='.lastTimestamp' 2>&1 |
  redact > "$output_directory/events.txt" || true
kubectl get pods,jobs,cronjobs,deployments --namespace "$namespace" --output wide 2>&1 |
  redact > "$output_directory/workloads.txt" || true

while IFS= read -r pod; do
  [[ -n "$pod" ]] || continue
  safe_name="$(printf '%s' "$pod" | tr -c '[:alnum:]._-' '_')"
  kubectl describe pod "$pod" --namespace "$namespace" 2>&1 |
    redact > "$output_directory/pods/$safe_name.txt" || true
  kubectl logs "$pod" --namespace "$namespace" --all-containers=true --prefix=true 2>&1 |
    redact > "$output_directory/logs/$safe_name.log" || true
  kubectl logs "$pod" --namespace "$namespace" --all-containers=true --prefix=true --previous 2>&1 |
    redact > "$output_directory/logs/$safe_name.previous.log" || true
done < <(kubectl get pods --namespace "$namespace" --output name 2>/dev/null || true)
