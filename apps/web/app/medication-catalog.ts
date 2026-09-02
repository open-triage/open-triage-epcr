import { NEMSIS_DATA_MODEL, requireNemsisDataElement, resolveNemsisElementValues } from "./nemsis-data-model";

export type MedicationOption = {
  readonly code: string;
  readonly codeType: "RxNorm" | "SNOMED-CT";
  readonly sourceLabel: string;
  readonly displayLabel: string;
};

export const MEDICATION_CATALOG_ID = "eMedications.03" as const;
const medicationList = NEMSIS_DATA_MODEL.bundledLists.find((list) => list.id === "medications-given")!;
const medicationSource = NEMSIS_DATA_MODEL.provenance.sources.find((source) => source.path.endsWith("/Medication.json"))!;
export const MEDICATION_CATALOG_PROVENANCE = {
  sha256: medicationSource.sha256, release: NEMSIS_DATA_MODEL.release, listDate: medicationList.publishedAt,
  sourceUrl: medicationSource.url, displayLabelProvenance: "NEMSIS catalog bundled-list SuggestedLabel",
};

export const MEDICATIONS: ReadonlyArray<MedicationOption> = resolveNemsisElementValues(requireNemsisDataElement(MEDICATION_CATALOG_ID)).permissibleValues.map((item) => ({
  code: item.code,
  codeType: "codeSystem" in item && item.codeSystem === "SNOMED-CT" ? "SNOMED-CT" : "RxNorm",
  sourceLabel: "sourceLabel" in item ? item.sourceLabel : item.label,
  displayLabel: item.label,
}));

export const MEDICATION_DOSE_UNITS = resolveNemsisElementValues(requireNemsisDataElement("eMedications.06")).permissibleValues.map(({ label }) => label);
export const MEDICATION_ROUTES = resolveNemsisElementValues(requireNemsisDataElement("eMedications.04")).permissibleValues.map(({ label }) => label);

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

export function searchMedicationCatalog(catalog: string, query: string, limit = 30): ReadonlyArray<MedicationOption> {
  if (catalog !== MEDICATION_CATALOG_ID) return [];
  return searchMedications(query, limit);
}
