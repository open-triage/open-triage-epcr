import catalog from "./data/nemsis-procedures.json";
import { standardEncounterDefinition } from "./standard-encounter-definition";
import type { ProcedureEventDefinition } from "./encounter-definition";

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

export const COMPLICATIONS = standardEncounterDefinition.events.procedure.complicationOptions;
export const OUTCOMES = standardEncounterDefinition.events.procedure.outcomeOptions;

export function searchProcedures(query: string, limit = 30, definition: ProcedureEventDefinition = standardEncounterDefinition.events.procedure): ReadonlyArray<ProcedureOption> {
  if (definition.terminology.catalog !== "nemsis-procedures-3.5.1") throw new Error(`Unsupported procedure catalog: ${definition.terminology.catalog}`);
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

export function validateProcedure(draft: ProcedureDraft, definition: ProcedureEventDefinition = standardEncounterDefinition.events.procedure): ProcedureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const attempts = Number(draft.attempts);

  const selectedProcedure = PROCEDURES.find((procedure) => procedure.code === draft.procedureCode);
  const message = (field: keyof ProcedureEventDefinition["references"], text: string) => `${definition.references[field]}${definition.required[field] ? " (Required)" : ""}: ${text}`;
  if (!selectedProcedure && definition.required.procedure) {
    errors.push(message("procedure", definition.validationMessages.procedureRequired));
  } else if (selectedProcedure && selectedProcedure.label !== draft.procedureLabel) {
    errors.push(message("procedure", definition.validationMessages.labelMismatch));
  }
  if (definition.required.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) {
    errors.push(message("time", definition.validationMessages.invalidTime));
  }
  if (definition.required.attempts && (!Number.isInteger(attempts) || attempts < definition.attempts.min || attempts > definition.attempts.max)) {
    errors.push(message("attempts", definition.validationMessages.invalidAttempts));
  }
  if (definition.required.success && !definition.successOptions.some((option) => option.value === draft.success)) {
    errors.push(message("success", definition.validationMessages.successRequired));
  }
  if (definition.required.complications && !draft.complications.length) {
    errors.push(message("complications", definition.validationMessages.complicationsRequired));
  }
  if (definition.required.outcome && !definition.outcomeOptions.some((outcome) => outcome.value === draft.outcome)) {
    errors.push(message("outcome", definition.validationMessages.outcomeRequired));
  }
  if (draft.complications.includes(definition.warningBehavior.noneCode) && draft.complications.length > 1) {
    warnings.push(definition.warningBehavior.noneWithOtherMessage);
  }
  if ((attempts > definition.warningBehavior.repeatedAttemptThreshold || draft.success === "no") && draft.complications.length === 1 && draft.complications[0] === definition.warningBehavior.noneCode) {
    warnings.push(definition.warningBehavior.repeatedOrUnsuccessfulMessage);
  }

  return { errors, warnings };
}

export function describeProcedure(record: ProcedureRecord, definition: ProcedureEventDefinition = standardEncounterDefinition.events.procedure): string {
  const success = record.success === "yes" ? definition.timeline.successful : definition.timeline.unsuccessful;
  const outcome = definition.outcomeOptions.find((candidate) => candidate.value === record.outcome)?.label ?? record.outcome;
  const complications = record.complications
    .map((code) => definition.complicationOptions.find((candidate) => candidate.code === code)?.label ?? code)
    .join(", ");
  return `${record.attempts} ${record.attempts === 1 ? definition.timeline.attemptSingular : definition.timeline.attemptPlural}, ${success} · ${outcome} · ${definition.timeline.complicationLabel}: ${complications}`;
}
