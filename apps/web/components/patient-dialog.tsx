"use client";

import { useState, type RefObject } from "react";
import type { Encounter } from "../app/synthetic-encounter";
import type { EncounterDefinition, PatientChoiceGroup } from "../app/encounter-definition";

type Patient = Encounter["patient"];
export function PatientDialog({ patient, definition, dialogRef, onClose, onSave }: {
  readonly patient: Patient;
  readonly definition: EncounterDefinition;
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onSave: (patient: Patient) => void;
}) {
  const [draft, setDraft] = useState(patient);

  function toggle(group: PatientChoiceGroup, label: string) {
    setDraft((current) => ({
      ...current,
      [group]: current[group].includes(label) ? current[group].filter((item) => item !== label) : [...current[group], label],
    }));
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="note-dialog patient-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title">
        <div className="note-dialog-heading">
          <div><p className="eyebrow">{definition.labels.patientDialogEyebrow}</p><h2 id="patient-dialog-title">{definition.labels.patientDialogTitle}</h2></div>
          <button aria-label="Close patient information" type="button" onClick={onClose}>×</button>
        </div>
        <label>
          {definition.labels.patientName}
          <input data-dialog-initial-focus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <div className="patient-demographic-row">
          <label>{definition.labels.age}<input inputMode="numeric" type="number" min="0" max="130" value={draft.age} onChange={(event) => setDraft({ ...draft, age: Number(event.target.value) })} /></label>
          <label>{definition.labels.sex}<select value={draft.sex} onChange={(event) => setDraft({ ...draft, sex: event.target.value })}><option value="">Select…</option><option value="F">Female</option><option value="M">Male</option><option value="X">Other / unknown</option></select></label>
        </div>
        <PatientChoices title={definition.labels.medicalHistory} group="medicalHistory" choices={definition.patient.choices.medicalHistory} selected={draft.medicalHistory} onToggle={toggle} />
        <PatientChoices title={definition.labels.currentMedications} group="currentMedications" choices={definition.patient.choices.currentMedications} selected={draft.currentMedications} onToggle={toggle} />
        <PatientChoices title={definition.labels.allergies} group="allergies" choices={definition.patient.choices.allergies} selected={draft.allergies} onToggle={toggle} />
        <div className="note-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => onSave(draft)}>{definition.labels.savePatient}</button>
        </div>
      </section>
    </div>
  );
}

function PatientChoices({ title, group, choices, selected, onToggle }: {
  readonly title: string;
  readonly group: PatientChoiceGroup;
  readonly choices: EncounterDefinition["patient"]["choices"][PatientChoiceGroup];
  readonly selected: ReadonlyArray<string>;
  readonly onToggle: (group: PatientChoiceGroup, label: string) => void;
}) {
  return (
    <fieldset className="patient-choice-group">
      <legend>{title}</legend>
      <div>
        {choices.map((choice) => (
          <label key={choice.label}>
            <input type="checkbox" checked={selected.includes(choice.label)} onChange={() => onToggle(group, choice.label)} />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
