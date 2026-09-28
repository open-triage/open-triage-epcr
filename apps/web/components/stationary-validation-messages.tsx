import React from "react";
import type { StationarySectionFinding } from "../app/stationary-record";
import { currentCatalogLanguage } from "../app/catalog-localization";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

export function stationaryFindingSeverity(findings: ReadonlyArray<StationarySectionFinding>): "error" | "warning" | undefined {
  if (findings.some(({ severity }) => severity === "error")) return "error";
  return findings.some(({ severity }) => severity === "warning") ? "warning" : undefined;
}

/** Keeps the reason adjacent to every highlighted stationary field or group. */
export function StationaryValidationMessages({ findings, language = currentCatalogLanguage() }: { readonly findings: ReadonlyArray<StationarySectionFinding>; readonly language?: AgencyLanguage }) {
  if (!findings.length) return null;
  return <div className="stationary-validation-messages" aria-live="polite">
    {findings.map((finding, index) => <p className={`stationary-validation-message ${finding.severity}`} role="alert" key={`${finding.severity}:${finding.message ?? "validation"}:${index}`}>
      <strong>{resolveMessage(language, finding.severity === "error" ? "stationary.validationError" : "stationary.validationWarning")}:</strong> {finding.message ?? resolveMessage(language, "stationary.validationFallback")}
    </p>)}
  </div>;
}
