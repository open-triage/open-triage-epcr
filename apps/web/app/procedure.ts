import catalog from "./data/nemsis-procedures.json";

export type ProcedureOption = {
  readonly code: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly category: string;
};

export type ProcedureOutcome = "improved" | "unchanged" | "worse" | "not-applicable";
export type ProcedureSuccess = "yes" | "no";

export type ProcedureRecord = {
  readonly code: string;
  readonly label: string;
  readonly attempts: number;
  readonly success: ProcedureSuccess;
  readonly outcome: ProcedureOutcome;
  readonly complications: ReadonlyArray<string>;
  readonly warningAcknowledged: boolean;
};

export type ProcedureDraft = {
  readonly id: string;
  readonly date: string;
  readonly time: string;
  readonly procedureCode: string;
  readonly procedureLabel: string;
  readonly attempts: string;
  readonly success: "" | ProcedureSuccess;
  readonly outcome: "" | ProcedureOutcome;
  readonly complications: ReadonlyArray<string>;
  readonly warningAcknowledged: boolean;
  readonly isNew: boolean;
};

export type ProcedureValidation = {
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

export const PROCEDURE_MANIFEST = catalog.manifest;
export const PROCEDURES: ReadonlyArray<ProcedureOption> = catalog.procedures;

const normalized = PROCEDURES.map((procedure, index) => ({
  procedure,
  index,
  haystack: `${procedure.label} ${procedure.sourceLabel} ${procedure.category} ${procedure.code}`.toLocaleLowerCase(),
}));

export const COMPLICATIONS = [
  { code: "3907001", label: "Altered mental status" },
  { code: "3907003", label: "Apnea" },
  { code: "3907033", label: "None" },
  { code: "3907005", label: "Bleeding" },
  { code: "3907007", label: "Bradypnea" },
  { code: "3907047", label: "Bradycardia" },
  { code: "3907009", label: "Diarrhea" },
  { code: "3907011", label: "Esophageal intubation—immediately" },
  { code: "3907013", label: "Esophageal intubation—other" },
  { code: "3907015", label: "Extravasation" },
  { code: "3907017", label: "Hypertension" },
  { code: "3907019", label: "Hyperthermia" },
  { code: "3907021", label: "Hypotension" },
  { code: "3907023", label: "Hypothermia" },
  { code: "3907025", label: "Hypoxia" },
  { code: "3907027", label: "Injury" },
  { code: "3907031", label: "Nausea" },
  { code: "3907035", label: "Other" },
  { code: "3907039", label: "Respiratory distress" },
  { code: "3907041", label: "Tachycardia" },
  { code: "3907043", label: "Tachypnea" },
  { code: "3907045", label: "Vomiting" },
  { code: "3907049", label: "Itching" },
  { code: "3907051", label: "Urticaria" },
] as const;

export const OUTCOMES = [
  { value: "improved", code: "9916001", label: "Improved" },
  { value: "unchanged", code: "9916003", label: "Unchanged" },
  { value: "worse", code: "9916005", label: "Worse" },
  { value: "not-applicable", code: "7701001", label: "Not applicable" },
] as const;

export function searchProcedures(query: string, limit = 30): ReadonlyArray<ProcedureOption> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return normalized
    .filter(({ haystack }) => terms.every((term) => haystack.includes(term)))
    .sort((a, b) => {
      if (!terms.length) return a.index - b.index;
      const phrase = terms.join(" ");
      const aLabel = a.procedure.label.toLocaleLowerCase();
      const bLabel = b.procedure.label.toLocaleLowerCase();
      const aScore = aLabel === phrase ? 0 : aLabel.startsWith(phrase) ? 1 : aLabel.includes(phrase) ? 2 : 3;
      const bScore = bLabel === phrase ? 0 : bLabel.startsWith(phrase) ? 1 : bLabel.includes(phrase) ? 2 : 3;
      return aScore - bScore || aLabel.localeCompare(bLabel);
    })
    .slice(0, limit)
    .map(({ procedure }) => procedure);
}

export function validateProcedure(draft: ProcedureDraft): ProcedureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const attempts = Number(draft.attempts);

  const selectedProcedure = PROCEDURES.find((procedure) => procedure.code === draft.procedureCode);
  if (!selectedProcedure) {
    errors.push("eProcedures.03 (Required): Select a procedure from the pinned NEMSIS list.");
  } else if (selectedProcedure.label !== draft.procedureLabel) {
    errors.push("eProcedures.03: The display label must match the selected SNOMED CT code.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) {
    errors.push("eProcedures.01 (Required): Enter the procedure time as HH:mm.");
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    errors.push("eProcedures.05 (Required): Attempts must be a whole number from 1 to 10.");
  }
  if (draft.success !== "yes" && draft.success !== "no") {
    errors.push("eProcedures.06 (Required): Record whether the procedure was successful.");
  }
  if (!draft.complications.length) {
    errors.push("eProcedures.07 (Required): Select None or at least one complication.");
  }
  if (!OUTCOMES.some((outcome) => outcome.value === draft.outcome)) {
    errors.push("eProcedures.08 (Required): Record the patient's response to the procedure.");
  }
  if (draft.complications.includes("3907033") && draft.complications.length > 1) {
    warnings.push('nemSch_e158: “None” should not be recorded with another procedure complication.');
  }
  if ((attempts > 1 || draft.success === "no") && draft.complications.length === 1 && draft.complications[0] === "3907033") {
    warnings.push("Chest-pain form warning: Review whether a complication should be documented for repeated or unsuccessful attempts.");
  }

  return { errors, warnings };
}

export function describeProcedure(record: ProcedureRecord): string {
  const success = record.success === "yes" ? "successful" : "unsuccessful";
  const outcome = OUTCOMES.find((candidate) => candidate.value === record.outcome)?.label ?? record.outcome;
  const complications = record.complications
    .map((code) => COMPLICATIONS.find((candidate) => candidate.code === code)?.label ?? code)
    .join(", ");
  return `${record.attempts} ${record.attempts === 1 ? "attempt" : "attempts"}, ${success} · ${outcome} · Complication: ${complications}`;
}
