"use client";
import { useState } from "react";
import type { AnalyticsResult } from "@open-triage/contracts";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { MetricEvidence } from "./metric-evidence";

export function AnalyticsEvidence({ result, language }: { result: AnalyticsResult; language: AgencyLanguage }) {
  const [open, setOpen] = useState(false);
  const t = (key: string) => resolveMessage(language, `analytics.${key}`);
  if (!result.evidence?.length) return null;
  return <details className="analytics-evidence" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t("evidence")}</summary>
    {open && <div className="analytics-table" role="region" tabIndex={0} aria-label={t("evidence")}><table>
      <thead><tr><th>{t("evidenceReport")}</th><th>{t("value")}</th><th>{t("evidenceReason")}</th></tr></thead>
      <tbody>{result.evidence.map(({ reportId, reportingDate, evaluation }) => <tr key={reportId}>
        <th scope="row">{reportingDate}<small>{reportId}</small></th>
        <td>{evaluation.state === "valid" ? typeof evaluation.value === "boolean" ? t(`outcome.${evaluation.value ? "pass" : "fail"}`)
          : `${evaluation.value} ${result.metric.unit ?? ""}` : t(evaluation.state === "not-applicable" ? "notApplicable" : evaluation.state)}</td>
        <td>{evaluation.reason}<MetricEvidence language={language} evidence={"metricId" in evaluation ? [evaluation] : "metricEvidence" in evaluation ? evaluation.metricEvidence : undefined} /></td>
      </tr>)}</tbody>
    </table></div>}
  </details>;
}
