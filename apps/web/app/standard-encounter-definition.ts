import type { EncounterDefinition } from "./encounter-definition";
import { medicationElementMetadata, procedureElementMetadata, vitalElementMetadata } from "./nemsis-form-profile";

const procedureReferences = { procedure: "eProcedures.03", time: "eProcedures.01", attempts: "eProcedures.05", success: "eProcedures.06", complications: "eProcedures.07", outcome: "eProcedures.08" } as const;
const procedureMetadata = procedureElementMetadata(procedureReferences);
const medicationReferences = [
  { id: "medication", reference: "eMedications.03" }, { id: "time", reference: "eMedications.01" }, { id: "dose", reference: "eMedications.05" },
  { id: "unit", reference: "eMedications.06" }, { id: "route", reference: "eMedications.04" }, { id: "response", reference: "eMedications.07" },
] as const;
const medicationMetadata = medicationElementMetadata(medicationReferences);

export const standardEncounterDefinition = {
  schemaVersion: 1, id: "standard-encounter-v1", version: 1, synthetic: true,
  labels: { incident: "Incident" },
  composition: {
    quickActionOrder: ["vitals", "medication", "procedure", "note"],
    review: {
      groups: [
        { severity: "error", title: "Blocking errors", empty: "No blocking errors." },
        { severity: "warning", title: "Warnings to acknowledge", empty: "No warnings." },
      ],
      eventTypeOrder: ["vitals", "medication", "procedure", "note"],
    },
  },
  events: {
    note: {
      quickAction: { visible: true, label: "Add clinical note" },
      labels: {
        category: "Note", timelineTitle: "Clinical note", newEyebrow: "New timeline event", editEyebrow: "Revise timeline event",
        editorTitle: "Clinical note", remove: "Remove", summary: "Note summary",
        summaryPlaceholder: "Document the clinical observation or decision…", cancel: "Cancel", add: "Add to timeline", save: "Save changes",
      },
      required: { summary: true },
      references: { summary: "eNarrative.01" },
      validationMessages: { summaryRequired: "Add a clinical note before signing." },
    },
    procedure: {
      quickAction: { visible: true, label: "Add procedure" },
      fieldOrder: ["procedure", "time", "attempts", "success", "outcome", "complications"],
      labels: {
        category: "Procedure", newEyebrow: "New treatment event", editEyebrow: "Edit canonical event", editorTitle: "Procedure",
        remove: "Remove", search: "Search procedures", searchPlaceholder: "Try ECG, IV, oxygen…",
        offlineCaption: "shown · available offline", noResults: "No procedure matches all search terms.", change: "Change",
        procedure: "Procedure", time: "Procedure time", attempts: "Attempts", success: "Successful", outcome: "Patient response",
        complications: "Complications", select: "Select…", cancel: "Cancel", add: "Add procedure", save: "Save changes",
        warningPill: "⚠ Warning: review needed",
      },
      terminology: procedureMetadata.terminology,
      required: procedureMetadata.required,
      references: procedureReferences,
      attempts: procedureMetadata.attempts,
      successOptions: procedureMetadata.successOptions,
      outcomeOptions: procedureMetadata.outcomeOptions,
      complicationOptions: procedureMetadata.complicationOptions,
      validationMessages: {
        procedureRequired: "Select a procedure from the pinned NEMSIS list.", labelMismatch: "The display label must match the selected SNOMED CT code.",
        invalidTime: "Enter the procedure time as HH:mm.", invalidAttempts: "Attempts must be a whole number from 1 to 10.",
        successRequired: "Record whether the procedure was successful.", complicationsRequired: "Select None or at least one complication.",
        outcomeRequired: "Record the patient's response to the procedure.",
      },
      warningBehavior: {
        noneCode: procedureMetadata.noneCode, repeatedAttemptThreshold: 1,
        noneWithOtherMessage: "nemSch_e158: “None” should not be recorded with another procedure complication.",
        repeatedOrUnsuccessfulMessage: "Standard encounter warning: Review whether a complication should be documented for repeated or unsuccessful attempts.",
      },
      timeline: { attemptSingular: "attempt", attemptPlural: "attempts", successful: "successful", unsuccessful: "unsuccessful", complicationLabel: "Complication" },
    },
    medication: {
      quickAction: { visible: true, label: "Add medication" },
      terminology: { catalog: "eMedications.03" },
      fields: [
        { id: "medication", label: "Search medications", required: medicationMetadata.required.get("medication")!, reference: "eMedications.03", placeholder: "Try aspirin, fentanyl, saline…" },
        { id: "time", label: "Medication time", required: medicationMetadata.required.get("time")!, reference: "eMedications.01" },
        { id: "dose", label: "Dose", required: medicationMetadata.required.get("dose")!, reference: "eMedications.05", placeholder: "e.g. 4" },
        { id: "unit", label: "Unit", required: medicationMetadata.required.get("unit")!, reference: "eMedications.06" },
        { id: "route", label: "Route", required: medicationMetadata.required.get("route")!, reference: "eMedications.04" },
        { id: "response", label: "Patient response", required: medicationMetadata.required.get("response")!, reference: "eMedications.07", placeholder: "e.g. pain 8 → 4; no adverse reaction", warnWhenMissing: true },
      ],
      doseUnits: medicationMetadata.doseUnits,
      routes: medicationMetadata.routes,
      labels: {
        category: "Medication", newEyebrow: "New timeline event", editEyebrow: "Revise timeline event", editorTitle: "Medication", remove: "Remove",
        searchResults: "Medication search results", availableOffline: "available offline", noMatches: "No medication matches your search.", change: "Change", select: "Select…", selectRoute: "Select route…",
        cancel: "Cancel", add: "Add medication", save: "Save changes", medicationMissing: "Medication not selected", routeMissing: "Route not documented", responseMissing: "Response not documented",
      },
      validationMessages: {
        invalidTime: "Enter a valid 24-hour time.", invalidMedication: "Select a medication from the NEMSIS recommended list.", invalidDose: "Dose must be a number greater than zero.",
        invalidUnit: "Select a valid configured dose unit.", invalidRoute: "Select a valid configured administration route.", responseMissing: "Medication response is not documented. You can acknowledge this warning and add it later.",
      },
    },
    vitals: {
      quickAction: { visible: true, label: "Add vital signs" },
      labels: {
        category: "Vital", timelineTitle: "Vital signs", newEyebrow: "New timeline event", editEyebrow: "Revise timeline event",
        editorTitle: "Vital signs", remove: "Remove", time: "Clinical time",
        absenceHelp: "Unavailable and pertinent-negative choices vary by field.", cancel: "Cancel", add: "Add vital set", save: "Save changes",
        absentSummary: "not recorded",
      },
      references: { group: "eVitals.VitalGroup", time: "eVitals.01" },
      validationMessages: { invalidTime: "eVitals.01 requires a valid clinical time (HH:mm).", emptyGroup: "eVitals.VitalGroup requires at least one documented vital element." },
      fields: [
        { id: "systolic", label: "Systolic BP", unit: "mmHg", reference: "eVitals.06", ...vitalElementMetadata("eVitals.06", 70, 220) },
        { id: "diastolic", label: "Diastolic BP", unit: "mmHg", reference: "eVitals.07", ...vitalElementMetadata("eVitals.07", 40, 130) },
        { id: "heartRate", label: "Heart rate", unit: "bpm", reference: "eVitals.10", ...vitalElementMetadata("eVitals.10", 40, 180) },
        { id: "spo2", label: "SpO₂", unit: "%", reference: "eVitals.12", ...vitalElementMetadata("eVitals.12", 90, 100) },
        { id: "respiratoryRate", label: "Respiratory rate", unit: "breaths/min", reference: "eVitals.14", ...vitalElementMetadata("eVitals.14", 8, 35) },
        { id: "gcs", label: "GCS total", unit: "score", reference: "eVitals.23", ...vitalElementMetadata("eVitals.23", 3, 15) },
        { id: "pain", label: "Pain score", unit: "score", reference: "eVitals.27", ...vitalElementMetadata("eVitals.27", 0, 7) },
      ],
      summary: [
        { label: "BP", fields: ["systolic", "diastolic"], separator: "/", unit: "" },
        { label: "HR", fields: ["heartRate"], separator: "", unit: "" },
        { label: "SpO₂", fields: ["spo2"], separator: "", unit: "%" },
        { label: "RR", fields: ["respiratoryRate"], separator: "", unit: "" },
        { label: "GCS", fields: ["gcs"], separator: "", unit: "" },
        { label: "pain", fields: ["pain"], separator: "", unit: "" },
      ],
    },
  },
} as const satisfies EncounterDefinition;
