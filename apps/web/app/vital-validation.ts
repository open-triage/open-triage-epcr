import type { NullValue, VitalField, VitalValues } from "./synthetic-encounter";

export type VitalRule = { label: string; reference: string; min: number; max: number; warningLow: number; warningHigh: number; required?: boolean; allowedNV: ReadonlyArray<NullValue>; allowedPN: ReadonlyArray<NullValue> };
const STANDARD_NV: ReadonlyArray<NullValue> = ["7701001", "7701003"];
const STANDARD_PN: ReadonlyArray<NullValue> = ["8801005", "8801019", "8801023"];
const LIMITED_PN: ReadonlyArray<NullValue> = ["8801019", "8801023"];
export const VITAL_RULES: Record<VitalField, VitalRule> = {
  systolic: { label: "Systolic BP", reference: "eVitals.06", min: 0, max: 500, warningLow: 70, warningHigh: 220, required: true, allowedNV: STANDARD_NV, allowedPN: STANDARD_PN },
  diastolic: { label: "Diastolic BP", reference: "eVitals.07", min: 0, max: 500, warningLow: 40, warningHigh: 130, required: true, allowedNV: [...STANDARD_NV, "7701005"], allowedPN: STANDARD_PN },
  heartRate: { label: "Heart rate", reference: "eVitals.10", min: 0, max: 500, warningLow: 40, warningHigh: 180, required: true, allowedNV: STANDARD_NV, allowedPN: STANDARD_PN },
  spo2: { label: "SpO₂", reference: "eVitals.12", min: 0, max: 100, warningLow: 90, warningHigh: 100, allowedNV: STANDARD_NV, allowedPN: STANDARD_PN },
  respiratoryRate: { label: "Respiratory rate", reference: "eVitals.14", min: 0, max: 300, warningLow: 8, warningHigh: 35, allowedNV: STANDARD_NV, allowedPN: STANDARD_PN },
  gcs: { label: "GCS total", reference: "eVitals.21", min: 3, max: 15, warningLow: 12, warningHigh: 15, allowedNV: STANDARD_NV, allowedPN: LIMITED_PN },
  pain: { label: "Pain score", reference: "eVitals.27", min: 0, max: 10, warningLow: 0, warningHigh: 7, allowedNV: STANDARD_NV, allowedPN: LIMITED_PN },
};
const NULL_LABELS: Record<NullValue, string> = { "": "Enter value", "7701001": "Not applicable (NV)", "7701003": "Not recorded (NV)", "7701005": "Not reporting (NV)", "8801005": "Finding not present (PN)", "8801019": "Refused (PN)", "8801023": "Unable to complete (PN)" };
export function nullOptionsFor(rule: VitalRule): ReadonlyArray<{ value: NullValue; label: string }> {
  return ["", ...rule.allowedNV, ...rule.allowedPN].map((value) => ({ value: value as NullValue, label: NULL_LABELS[value as NullValue] }));
}
export type VitalValidation = { errors: Partial<Record<VitalField | "time" | "group", string>>; warnings: Partial<Record<VitalField, string>>; valid: boolean };
export function validateVitals(time: string, values: VitalValues): VitalValidation {
  const errors: VitalValidation["errors"] = {};
  const warnings: VitalValidation["warnings"] = {};
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = "eVitals.01 requires a valid clinical time (HH:mm).";
  let supplied = 0;
  for (const [field, rule] of Object.entries(VITAL_RULES) as [VitalField, VitalRule][]) {
    const raw = values[field]; const nv = values.nullValues[field];
    if (raw || nv) supplied += 1;
    if (!raw && !nv && rule.required) errors[field] = `${rule.reference} requires a value or permitted NV.`;
    if (nv && !rule.allowedNV.includes(nv) && !rule.allowedPN.includes(nv)) errors[field] = `${rule.reference} does not permit NV/PN ${nv}.`;
    if (raw) {
      const number = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(number) || number < rule.min || number > rule.max) errors[field] = `${rule.reference} must be an integer from ${rule.min} to ${rule.max}.`;
      else if (number < rule.warningLow || number > rule.warningHigh) warnings[field] = `Clinically unusual ${rule.label.toLowerCase()}; confirm before saving.`;
    }
  }
  if (!supplied) errors.group = "eVitals.VitalGroup requires at least one documented vital element.";
  return { errors, warnings, valid: Object.keys(errors).length === 0 };
}
