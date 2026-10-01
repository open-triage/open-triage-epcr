import type { CatalogDraftCustomCodedElement } from "@open-triage/contracts";

// Pinned NEMSIS 3.5.1 eCustomConfiguration.07/.08 enumerations.
export const CUSTOM_NOT_VALUES = ["7701001", "7701003", "7701005"] as const;
export const CUSTOM_PERTINENT_NEGATIVES = ["8801001", "8801003", "8801005", "8801007", "8801009",
  "8801013", "8801015", "8801017", "8801019", "8801021", "8801023", "8801025",
  "8801027", "8801029", "8801031"] as const;

export function customCodedDefinitionFindings(item: CatalogDraftCustomCodedElement): string[] {
  const findings: string[] = [];
  if (item.datatype !== "coded") findings.push("Custom coded definitions require a coded datatype");
  if (typeof item.codeSystem !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(item.codeSystem) || item.codeSystem.length > 255)
    findings.push("Custom code system must be a URI of at most 255 characters");
  if (typeof item.codeSystem === "string" && /^urn:nemsis(?::|$)/i.test(item.codeSystem))
    findings.push("A custom code system cannot claim the NEMSIS identity");
  if (!Array.isArray(item.choices) || !item.choices.length) findings.push("Custom coded definitions need at least one choice");
  const codes = new Set<string>();
  for (const [index, choice] of (Array.isArray(item.choices) ? item.choices : []).entries()) {
    if (!choice || typeof choice.code !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(choice.code))
      findings.push(`choice ${index} needs a stable code of at most 255 characters`);
    else if (codes.has(choice.code)) findings.push(`Duplicate custom code ${choice.code}`);
    else codes.add(choice.code);
    if (typeof choice?.label !== "string" || !choice.label.trim() || choice.label.length > 255)
      findings.push(`choice ${index} needs a label of at most 255 characters`);
    if (choice?.nemsisCode !== undefined && (typeof choice.nemsisCode !== "string" || !choice.nemsisCode.trim()))
      findings.push(`choice ${index} has an invalid NEMSIS code mapping`);
    if (choice?.localization !== undefined && (choice.localization.schemaVersion !== 1 ||
      typeof choice.localization.sv?.label !== "string" || !choice.localization.sv.label.trim() ||
      choice.localization.sv.label.length > 255))
      findings.push(`choice ${index} translation is invalid`);
  }
  if (item.nemsisElement !== undefined && (typeof item.nemsisElement !== "string" || !/^e[A-Za-z0-9]+\.\d{2}$/.test(item.nemsisElement)))
    findings.push("NEMSIS element mapping must be an EMS data element identifier");
  for (const [key, permitted] of [["permittedNotValues", CUSTOM_NOT_VALUES],
    ["permittedPertinentNegatives", CUSTOM_PERTINENT_NEGATIVES]] as const) {
    const values = item[key];
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !permitted.includes(value as never)) ||
      new Set(values).size !== values.length) findings.push(`${key} must contain distinct pinned NEMSIS 3.5.1 codes`);
  }
  return findings;
}
