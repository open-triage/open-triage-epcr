import { adultChestPainDefinition } from "./adult-chest-pain-definition";
import type { EncounterDefinition, VitalField, VitalFieldDefinition, VitalNullValue } from "./encounter-definition";
import type { VitalValues } from "./synthetic-encounter";

export type NullValue = "" | VitalNullValue;

export function nullOptionsFor(field: VitalFieldDefinition): ReadonlyArray<{ value: NullValue; label: string }> {
  return [{ value: "", label: "Enter value" }, ...field.absenceStates.map(({ code, label }) => ({ value: code, label }))];
}

export type VitalValidation = {
  readonly errors: Partial<Record<VitalField | "time" | "group", string>>;
  readonly warnings: Partial<Record<VitalField, string>>;
  readonly valid: boolean;
};

/** Validates stored vital values exclusively against the selected encounter definition. */
export function validateVitals(time: string, values: VitalValues, definition: EncounterDefinition = adultChestPainDefinition): VitalValidation {
  const config = definition.events.vitals;
  const errors: VitalValidation["errors"] = {};
  const warnings: VitalValidation["warnings"] = {};
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = config.validationMessages.invalidTime;
  let supplied = 0;
  for (const field of config.fields) {
    const raw = values[field.id] ?? "";
    const absence = values.nullValues?.[field.id];
    if (raw || absence) supplied += 1;
    if (!raw && !absence && field.required) errors[field.id] = `${field.reference} requires a value or permitted NV.`;
    if (absence && !field.absenceStates.some(({ code }) => code === absence)) errors[field.id] = `${field.reference} does not permit NV/PN ${absence}.`;
    if (raw) {
      const number = Number(raw);
      const { min, max, warningLow, warningHigh } = field.boundaries;
      if (!/^\d+$/.test(raw) || !Number.isInteger(number) || number < min || number > max) errors[field.id] = `${field.reference} must be an integer from ${min} to ${max}.`;
      else if (number < warningLow || number > warningHigh) warnings[field.id] = `Clinically unusual ${field.label.toLowerCase()}; confirm before saving.`;
    }
  }
  if (!supplied) errors.group = config.validationMessages.emptyGroup;
  return { errors, warnings, valid: Object.keys(errors).length === 0 };
}
