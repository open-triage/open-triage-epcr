"use client";

import { useState, type RefObject } from "react";
import type { Encounter } from "../app/synthetic-encounter";

type Patient = Encounter["patient"];
type ChoiceGroup = "medicalHistory" | "currentMedications" | "allergies";

const CHOICES: Record<ChoiceGroup, ReadonlyArray<{ label: string; source: string }>> = {
  medicalHistory: [
    { label: "Coronary artery disease", source: "eHistory.08" },
    { label: "Hypertension", source: "eHistory.08" },
    { label: "Diabetes", source: "eHistory.08" },
    { label: "COPD / chronic lung disease", source: "eHistory.08" },
    { label: "Stroke / TIA", source: "eHistory.08" },
    { label: "Seizure disorder", source: "eHistory.08" },
  ],
  currentMedications: [
    { label: "Aspirin", source: "eHistory.12" },
    { label: "Beta blocker", source: "eHistory.12" },
    { label: "Anticoagulant", source: "eHistory.12" },
    { label: "Insulin", source: "eHistory.12" },
    { label: "Nitroglycerin", source: "eHistory.12" },
  ],
  allergies: [
    { label: "Penicillin", source: "eHistory.06" },
    { label: "Sulfonamides", source: "eHistory.06" },
    { label: "NSAIDs", source: "eHistory.06" },
    { label: "Opioids", source: "eHistory.06" },
    { label: "No known drug allergies", source: "eHistory.06 PN" },
  ],
};

export function PatientDialog({ patient, dialogRef, onClose, onSave }: {
  readonly patient: Patient;
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onSave: (patient: Patient) => void;
}) {
  const [draft, setDraft] = useState(patient);

  function toggle(group: ChoiceGroup, label: string) {
    setDraft((current) => ({
      ...current,
      [group]: current[group].includes(label) ? current[group].filter((item) => item !== label) : [...current[group], label],
    }));
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="note-dialog patient-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title">
        <div className="note-dialog-heading">
          <div><p className="eyebrow">Quick patient details</p><h2 id="patient-dialog-title">Patient information</h2></div>
          <button aria-label="Close patient information" type="button" onClick={onClose}>×</button>
        </div>
        <label>
          Patient name
          <input data-dialog-initial-focus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <div className="patient-demographic-row">
          <label>Age<input inputMode="numeric" type="number" min="0" max="130" value={draft.age} onChange={(event) => setDraft({ ...draft, age: Number(event.target.value) })} /></label>
          <label>Sex<select value={draft.sex} onChange={(event) => setDraft({ ...draft, sex: event.target.value })}><option value="">Select…</option><option value="F">Female</option><option value="M">Male</option><option value="X">Other / unknown</option></select></label>
        </div>
        <PatientChoices title="Medical history" group="medicalHistory" selected={draft.medicalHistory} onToggle={toggle} />
        <PatientChoices title="Current medications" group="currentMedications" selected={draft.currentMedications} onToggle={toggle} />
        <PatientChoices title="Medication allergies" group="allergies" selected={draft.allergies} onToggle={toggle} />
        <div className="note-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => onSave(draft)}>Save patient</button>
        </div>
      </section>
    </div>
  );
}

function PatientChoices({ title, group, selected, onToggle }: {
  readonly title: string;
  readonly group: ChoiceGroup;
  readonly selected: ReadonlyArray<string>;
  readonly onToggle: (group: ChoiceGroup, label: string) => void;
}) {
  return (
    <fieldset className="patient-choice-group">
      <legend>{title}</legend>
      <div>
        {CHOICES[group].map((choice) => (
          <label key={choice.label}>
            <input type="checkbox" checked={selected.includes(choice.label)} onChange={() => onToggle(group, choice.label)} />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
