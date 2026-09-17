{{- define "open-triage.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "open-triage.fullname" -}}
{{- if .Values.fullnameOverride }}{{ .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}{{ else }}{{ include "open-triage.name" . }}{{ end }}
{{- end }}

{{/* Resolve a workload-specific cluster-owned or Helm-managed Secret. */}}
{{- define "open-triage.workloadSecretName" -}}
{{- default (printf "%s-%s-database" (include "open-triage.fullname" .root) .workload) .config.existingSecret -}}
{{- end }}

{{- define "open-triage.labels" -}}
app.kubernetes.io/name: {{ include "open-triage.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end }}
