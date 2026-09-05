import type { ReviewFinding } from "../app/standard-encounter";

/** Keeps a selected review finding attached to the control that can resolve it. */
export function DialogValidationMessage({ finding }: { readonly finding?: Pick<ReviewFinding, "severity" | "message"> }) {
  if (!finding) return null;
  return <p className={`dialog-validation-message validation-message ${finding.severity}`} role="alert">
    <strong>{finding.severity === "error" ? "Error" : "Warning"}:</strong> {finding.message}
  </p>;
}
