import { resolveMessage, type AgencyLanguage } from "../app/localization";
import type { ReviewFinding } from "../app/standard-encounter";

/** Keeps a selected review finding attached to the control that can resolve it. */
export function DialogValidationMessage({ finding, language = "en" }: { readonly language?: AgencyLanguage; readonly finding?: Pick<ReviewFinding, "severity" | "message"> }) {
  if (!finding) return null;
  return <p className={`dialog-validation-message validation-message ${finding.severity}`} role="alert">
    <strong>{finding.severity === "error" ? resolveMessage(language, "mobile.validationErrorLabel") : resolveMessage(language, "mobile.validationWarningLabel")}</strong> {finding.message}
  </p>;
}
