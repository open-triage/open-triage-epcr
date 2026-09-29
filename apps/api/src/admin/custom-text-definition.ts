import type { CatalogDraftCustomElement, CatalogDraftCustomCodedElement } from "@open-triage/contracts";
import { customCodedDefinitionFindings } from "./custom-coded-definition.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const namespace = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const slug = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function customTextDefinitionFindings(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Custom text definition must be an object"];
  const item = value as Partial<CatalogDraftCustomElement>;
  const findings: string[] = [];
  if (typeof item.id !== "string" || !uuid.test(item.id)) findings.push("Custom identity must be a version-4 UUID");
  if (typeof item.namespace !== "string" || !namespace.test(item.namespace)) findings.push("Custom namespace must be namespaced and distinct from NEMSIS");
  if (typeof item.slug !== "string" || !slug.test(item.slug)) findings.push("Custom slug is invalid");
  if (typeof item.namespace === "string" && typeof item.slug === "string" && `${item.namespace}.${item.slug}`.length > 255)
    findings.push("Custom identity exceeds the NEMSIS 255-character limit");
  if (typeof item.title !== "string" || item.title.trim().length < 2 || item.title.length > 100) findings.push("Custom title must contain 2–100 characters");
  if (typeof item.definition !== "string" || item.definition.trim().length < 2 || item.definition.length > 255) findings.push("Custom definition must contain 2–255 characters");
  if (!["string", "number", "dateTime", "boolean", "binary", "other", "coded"].includes(String(item.datatype)) ||
      !["single", "multiple"].includes(String(item.recurrence)))
    findings.push("Choose a supported custom datatype and single or multiple recurrence");
  if (item.correlatesTo !== undefined && !["eMedications.MedicationGroup", "eExam.AssessmentGroup"].includes(item.correlatesTo))
    findings.push("Correlation target must be a supported repeated medication or assessment group");
  if (item.groupDefinitionId !== undefined && (typeof item.groupDefinitionId !== "string" || !uuid.test(item.groupDefinitionId)))
    findings.push("Custom grouping reference must be a version-4 UUID");
  if (!["Mandatory", "Required", "Recommended", "Optional"].includes(String(item.usage))) findings.push("Custom usage is invalid");
  if (item.identifying !== true && item.identifying !== false) findings.push("Choose whether this field contains identifying information");
  if (item.retired !== undefined && typeof item.retired !== "boolean") findings.push("Custom retirement state must be a boolean");
  if (item.datatype === "coded") return [...findings, ...customCodedDefinitionFindings(item as CatalogDraftCustomCodedElement)];
  const constraints = "constraints" in item ? item.constraints : undefined;
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) findings.push("Custom constraints are required");
  else {
    const allowed = item.datatype === "string" || item.datatype === "other" ? ["minLength", "maxLength", "pattern"]
      : item.datatype === "number" ? ["minimum", "maximum"] : [];
    if (Object.keys(constraints).some((key) => !allowed.includes(key))) findings.push(`Unsupported ${String(item.datatype)} constraint`);
    for (const key of ["minLength", "maxLength"] as const) if (constraints[key] !== undefined &&
      (!Number.isInteger(constraints[key]) || Number(constraints[key]) < 0)) findings.push(`${key} must be a non-negative integer`);
    if (constraints.minLength !== undefined && constraints.maxLength !== undefined && constraints.minLength > constraints.maxLength)
      findings.push("minLength must not exceed maxLength");
    if (constraints.minLength !== undefined && constraints.minLength > 100000 ||
        constraints.maxLength !== undefined && constraints.maxLength > 100000)
      findings.push("Text length exceeds the NEMSIS CustomResults limit of 100000 characters");
    if (constraints.pattern !== undefined) {
      if (typeof constraints.pattern !== "string" || constraints.pattern.length > 255) findings.push("Pattern must be text of at most 255 characters");
      else try { new RegExp(constraints.pattern); } catch { findings.push("Pattern must be a valid regular expression"); }
    }
    for (const key of ["minimum", "maximum"] as const) if (constraints[key] !== undefined &&
      (typeof constraints[key] !== "number" || !Number.isFinite(constraints[key]))) findings.push(`${key} must be a finite number`);
    if (constraints.minimum !== undefined && constraints.maximum !== undefined && constraints.minimum > constraints.maximum)
      findings.push("minimum must not exceed maximum");
  }
  return findings;
}
