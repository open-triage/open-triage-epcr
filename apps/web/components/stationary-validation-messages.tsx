import React from "react";
import type { StationarySectionFinding } from "../app/stationary-record";

export function stationaryFindingSeverity(findings: ReadonlyArray<StationarySectionFinding>): "error" | "warning" | undefined {
  if (findings.some(({ severity }) => severity === "error")) return "error";
  return findings.some(({ severity }) => severity === "warning") ? "warning" : undefined;
}

/** Keeps the reason adjacent to every highlighted stationary field or group. */
export function StationaryValidationMessages({ findings }: { readonly findings: ReadonlyArray<StationarySectionFinding> }) {
  if (!findings.length) return null;
  return <div className="stationary-validation-messages" aria-live="polite">
    {findings.map((finding, index) => <p className={`stationary-validation-message ${finding.severity}`} role="alert" key={`${finding.severity}:${finding.message ?? "validation"}:${index}`}>
      <strong>{finding.severity === "error" ? "Error" : "Warning"}:</strong> {finding.message ?? "This value did not pass validation."}
    </p>)}
  </div>;
}
