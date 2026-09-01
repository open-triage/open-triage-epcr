import source from "./medications.nemsis-3.5.1.json";
import manifest from "./medications.nemsis-3.5.1.manifest.json";

export type MedicationOption = {
  readonly code: string;
  readonly codeType: "RxNorm" | "SNOMED-CT";
  readonly sourceLabel: string;
  readonly displayLabel: string;
};

type SourceCode = {
  readonly Value: { readonly CodeType: "9924003" | "9924005"; readonly Value: string };
  readonly SourceLabel: string;
  readonly SuggestedLabel: string;
};

export const MEDICATION_CATALOG_PROVENANCE = manifest;

export const MEDICATIONS: ReadonlyArray<MedicationOption> = (source.DefinedList.Codes.Code as ReadonlyArray<SourceCode>).map((item) => ({
  code: item.Value.Value,
  codeType: item.Value.CodeType === "9924003" ? "RxNorm" : "SNOMED-CT",
  sourceLabel: item.SourceLabel,
  displayLabel: item.SuggestedLabel,
}));

export const MEDICATION_DOSE_UNITS = ["mg", "mcg", "g", "mL", "units", "L/min"] as const;
export const MEDICATION_ROUTES = ["PO — Oral", "IV — Intravenous", "IM — Intramuscular", "IN — Intranasal", "SL — Sublingual", "IO — Intraosseous", "Nebulized", "Topical"] as const;

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchMedications(query: string, limit = 30): ReadonlyArray<MedicationOption> {
  const needle = normalize(query);
  if (!needle) return MEDICATIONS.slice(0, limit);
  return MEDICATIONS
    .filter((item) => normalize(`${item.displayLabel} ${item.sourceLabel} ${item.code}`).includes(needle))
    .slice(0, limit);
}
