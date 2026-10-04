"use client";
import type { MetricResult } from "@open-triage/contracts";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

export function MetricEvidence({ evidence, language }: { evidence: MetricResult[] | undefined; language: AgencyLanguage }) {
  if (!evidence?.length) return null;
  return <details className="metric-evidence"><summary>{resolveMessage(language, "metrics.evidence")}</summary>
    {evidence.map((metric) => <div key={metric.metricId}><p><code>{metric.metricId}</code> · {metric.state === "valid" ? `${metric.value} ${metric.unit}` : metric.reason ?? metric.state}</p>
      <small>{metric.validationVersionId}</small><ul>{metric.observations.map((observation, index) => <li key={index}>
        <code>{observation.elementId}</code> · {observation.groupInstanceId}: {observation.values.map((value) =>
          value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : value.kind).join(", ")}
      </li>)}</ul></div>)}
  </details>;
}
