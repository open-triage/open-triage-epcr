import type { CatalogDraftCustomGroup } from "@open-triage/contracts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const namespace = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const slug = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function customGroupDefinitionFindings(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Custom group must be an object"];
  const group = value as Partial<CatalogDraftCustomGroup>;
  const findings: string[] = [];
  if (typeof group.id !== "string" || !uuid.test(group.id)) findings.push("Custom group identity must be a version-4 UUID");
  if (typeof group.namespace !== "string" || !namespace.test(group.namespace)) findings.push("Custom group namespace is invalid");
  if (typeof group.slug !== "string" || !slug.test(group.slug)) findings.push("Custom group slug is invalid");
  if (typeof group.title !== "string" || group.title.trim().length < 2 || group.title.length > 100) findings.push("Custom group title must contain 2–100 characters");
  if (group.recurrence !== "single" && group.recurrence !== "multiple") findings.push("Custom group recurrence must be single or multiple");
  if (group.correlatesTo !== undefined && (typeof group.correlatesTo !== "string" || !group.correlatesTo.trim())) findings.push("Custom group correlation target is invalid");
  if (group.localization !== undefined && (group.localization.schemaVersion !== 1 ||
    !group.localization.sv?.label?.trim() || group.localization.sv.reviewedSource?.label !== group.title))
    findings.push("Custom group translation must review the current English title");
  return findings;
}
