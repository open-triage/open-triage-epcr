{{- define "open-triage.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "open-triage.fullname" -}}
{{- if .Values.fullnameOverride }}{{ .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}{{ else }}{{ include "open-triage.name" . }}{{ end }}
{{- end }}

{{/* Use a cluster-owned database Secret when one is configured. */}}
{{- define "open-triage.databaseSecretName" -}}
{{- default (printf "%s-database" (include "open-triage.fullname" .)) .Values.secrets.existingSecret -}}
{{- end }}

{{- define "open-triage.labels" -}}
app.kubernetes.io/name: {{ include "open-triage.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end }}
