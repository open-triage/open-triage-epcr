"use client";

import { useMemo, useState, type RefObject } from "react";
import type { EncounterDocument } from "@open-triage/contracts";
import type { EncounterDefinition } from "../app/encounter-definition";
import {
  patientDraftFromDocument,
  patientEditorField,
  updatePatientDocument,
  type PatientChoice,
  type PatientDraft,
  type PatientFieldId,
  type PatientScalarFieldId,
} from "../app/patient-document";

export function PatientDialog({ document, definition, dialogRef, onClose, onSave }: {
  readonly document: EncounterDocument;
  readonly definition: EncounterDefinition;
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onSave: (document: EncounterDocument) => void;
}) {
  const [draft, setDraft] = useState(() => patientDraftFromDocument(document));
  const fields = useMemo(() => Object.fromEntries(
    (["identifier", "lastName", "firstName", "age", "sex", "medicalHistory", "currentMedications", "allergies"] as const).map((id) => [id, patientEditorField(id)]),
  ) as Record<PatientFieldId, ReturnType<typeof patientEditorField>>, []);

  function toggle(group: "medicalHistory" | "currentMedications" | "allergies", choice: PatientChoice) {
    setDraft((current) => {
      const selected = current[group].some((item) => item.kind === choice.kind && item.code === choice.code);
      const next = selected
        ? current[group].filter((item) => item.kind !== choice.kind || item.code !== choice.code)
        : choice.kind === "coded"
          ? [...current[group].filter((item) => item.kind === "coded"), choice]
          : [choice];
      return { ...current, [group]: next };
    });
  }

  const scalar = (id: "identifier" | "lastName" | "firstName", value: string) => setDraft((current) => ({ ...current, [id]: value, absence: { ...current.absence, [id]: undefined } }));
  const setAbsence = (id: PatientScalarFieldId, value: string) => setDraft((current) => ({
    ...current,
    absence: { ...current.absence, [id]: fields[id].choices.find((choice) => `${choice.kind}:${choice.code}` === value) },
  }));
  const ageConstraints = fields.age.datatype.constraints;
  const sexValue = draft.sex ? `${draft.sex.kind}:${draft.sex.code}` : "";
  const scalarValid = (id: PatientScalarFieldId, value: string | number) => {
    if (draft.absence[id]) return true;
    const constraints = fields[id].datatype.constraints;
    if (typeof value === "number") return Number.isInteger(value)
      && (typeof constraints.minInclusive !== "number" || value >= constraints.minInclusive)
      && (typeof constraints.maxInclusive !== "number" || value <= constraints.maxInclusive);
    return (!value || typeof constraints.minLength !== "number" || value.length >= constraints.minLength)
      && (typeof constraints.maxLength !== "number" || value.length <= constraints.maxLength);
  };
  const canSave = scalarValid("identifier", draft.identifier) && scalarValid("lastName", draft.lastName)
    && scalarValid("firstName", draft.firstName) && scalarValid("age", draft.age);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="note-dialog patient-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title">
        <div className="note-dialog-heading">
          <div><p className="eyebrow">{definition.labels.patientDialogEyebrow}</p><h2 id="patient-dialog-title">{definition.labels.patientDialogTitle}</h2></div>
          <button aria-label="Close patient information" type="button" onClick={onClose}>×</button>
        </div>
        <label>{fields.identifier.label}<input data-dialog-initial-focus minLength={Number(fields.identifier.datatype.constraints.minLength)} maxLength={Number(fields.identifier.datatype.constraints.maxLength)} value={draft.identifier} onChange={(event) => scalar("identifier", event.target.value)} /></label>
        <div className="patient-demographic-row">
          <label>{fields.lastName.label}<input disabled={!!draft.absence.lastName} value={draft.lastName} onChange={(event) => scalar("lastName", event.target.value)} /><AvailabilitySelect field={fields.lastName} value={draft.absence.lastName} onChange={(value) => setAbsence("lastName", value)} /></label>
          <label>{fields.firstName.label}<input disabled={!!draft.absence.firstName} value={draft.firstName} onChange={(event) => scalar("firstName", event.target.value)} /><AvailabilitySelect field={fields.firstName} value={draft.absence.firstName} onChange={(value) => setAbsence("firstName", value)} /></label>
        </div>
        <div className="patient-demographic-row">
          <label>{fields.age.label}<input disabled={!!draft.absence.age} inputMode="numeric" type="number" min={Number(ageConstraints.minInclusive)} max={Number(ageConstraints.maxInclusive)} value={draft.age} onChange={(event) => setDraft({ ...draft, age: Number(event.target.value), absence: { ...draft.absence, age: undefined } })} /><AvailabilitySelect field={fields.age} value={draft.absence.age} onChange={(value) => setAbsence("age", value)} /></label>
          <label>{fields.sex.label}<select value={sexValue} onChange={(event) => setDraft({ ...draft, sex: fields.sex.choices.find((choice) => `${choice.kind}:${choice.code}` === event.target.value) ?? null })}>
            <option value="">Select…</option>
            {fields.sex.choices.map((choice) => <option key={`${choice.kind}:${choice.code}`} value={`${choice.kind}:${choice.code}`}>{choice.label}</option>)}
          </select></label>
        </div>
        <PatientChoices field={fields.medicalHistory} selected={draft.medicalHistory} onToggle={(choice) => toggle("medicalHistory", choice)} />
        <PatientChoices field={fields.currentMedications} selected={draft.currentMedications} onToggle={(choice) => toggle("currentMedications", choice)} />
        <PatientChoices field={fields.allergies} selected={draft.allergies} onToggle={(choice) => toggle("allergies", choice)} />
        <div className="note-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!canSave} onClick={() => onSave(updatePatientDocument(document, draft))}>{definition.labels.savePatient}</button>
        </div>
      </section>
    </div>
  );
}

function AvailabilitySelect({ field, value, onChange }: {
  readonly field: ReturnType<typeof patientEditorField>;
  readonly value?: PatientChoice;
  readonly onChange: (value: string) => void;
}) {
  const choices = field.choices.filter(({ kind }) => kind !== "coded");
  if (!choices.length) return null;
  return <select aria-label={`${field.label} availability`} value={value ? `${value.kind}:${value.code}` : ""} onChange={(event) => onChange(event.target.value)}>
    <option value="">Documented</option>
    {choices.map((choice) => <option key={`${choice.kind}:${choice.code}`} value={`${choice.kind}:${choice.code}`}>{choice.label}</option>)}
  </select>;
}

function PatientChoices({ field, selected, onToggle }: {
  readonly field: ReturnType<typeof patientEditorField>;
  readonly selected: PatientDraft["medicalHistory"];
  readonly onToggle: (choice: PatientChoice) => void;
}) {
  return (
    <fieldset className="patient-choice-group">
      <legend>{field.label}</legend>
      <div>
        {field.choices.map((choice) => (
          <label key={`${choice.kind}:${choice.code}`}>
            <input type="checkbox" checked={selected.some((item) => item.kind === choice.kind && item.code === choice.code)} onChange={() => onToggle(choice)} />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
