import type { CatalogDraftCustomTextElement } from "@open-triage/contracts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const namespace = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const slug = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function customTextDefinitionFindings(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Custom text definition must be an object"];
  const item = value as Partial<CatalogDraftCustomTextElement>;
  const findings: string[] = [];
  if (typeof item.id !== "string" || !uuid.test(item.id)) findings.push("Custom identity must be a version-4 UUID");
  if (typeof item.namespace !== "string" || !namespace.test(item.namespace)) findings.push("Custom namespace must be namespaced and distinct from NEMSIS");
  if (typeof item.slug !== "string" || !slug.test(item.slug)) findings.push("Custom slug is invalid");
  if (item.title?.trim().length === 0 || typeof item.title !== "string" || item.title.length > 100) findings.push("Custom title must contain 1–100 characters");
  if (item.definition?.trim().length === 0 || typeof item.definition !== "string" || item.definition.length > 255) findings.push("Custom definition must contain 1–255 characters");
  if (item.datatype !== "string" || item.recurrence !== "single") findings.push("This catalog supports standalone single-value text definitions");
  if (!["Mandatory", "Required", "Recommended", "Optional"].includes(String(item.usage))) findings.push("Custom usage is invalid");
  if (item.identifying !== true && item.identifying !== false) findings.push("Choose whether this field contains identifying information");
  const constraints = item.constraints;
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) findings.push("Custom text constraints are required");
  else {
    if (Object.keys(constraints).some((key) => !["minLength", "maxLength", "pattern"].includes(key))) findings.push("Unsupported custom text constraint");
    for (const key of ["minLength", "maxLength"] as const) if (constraints[key] !== undefined &&
      (!Number.isInteger(constraints[key]) || Number(constraints[key]) < 0)) findings.push(`${key} must be a non-negative integer`);
    if (constraints.minLength !== undefined && constraints.maxLength !== undefined && constraints.minLength > constraints.maxLength)
      findings.push("minLength must not exceed maxLength");
    if (constraints.pattern !== undefined) {
      if (typeof constraints.pattern !== "string" || constraints.pattern.length > 255) findings.push("Pattern must be text of at most 255 characters");
      else try { new RegExp(constraints.pattern); } catch { findings.push("Pattern must be a valid regular expression"); }
    }
  }
  return findings;
}
