import type { EncounterDefinition } from "./encounter-definition";

export const adultChestPainDefinition = {
  schemaVersion: 1, id: "adult-chest-pain-v2", version: 1, synthetic: true,
  dates: { clinicalDate: "2026-04-18", currentTime: "07:51" },
  labels: { prototypeStatus: "Prototype", incident: "Incident", patientDialogEyebrow: "Quick patient details", patientDialogTitle: "Patient information", patientName: "Patient name", age: "Age", sex: "Sex", medicalHistory: "Medical history", currentMedications: "Current medications", allergies: "Medication allergies", savePatient: "Save patient" },
  patient: {
    initial: { name: "Lindqvist, Margareta", age: 73, sex: "F", identifier: "19530418-XXXX", medicalHistory: [], currentMedications: [], allergies: [] },
    references: { name: "ePatient.02", age: "ePatient.15", sex: "ePatient.13", identifier: "ePatient.01" },
    choices: {
      medicalHistory: ["Coronary artery disease", "Hypertension", "Diabetes", "COPD / chronic lung disease", "Stroke / TIA", "Seizure disorder"].map((label) => ({ label, reference: "eHistory.08" as const })),
      currentMedications: ["Aspirin", "Beta blocker", "Anticoagulant", "Insulin", "Nitroglycerin"].map((label) => ({ label, reference: "eHistory.12" as const })),
      allergies: [...["Penicillin", "Sulfonamides", "NSAIDs", "Opioids"].map((label) => ({ label, reference: "eHistory.06" as const })), { label: "No known drug allergies", reference: "eHistory.06 PN" }],
    },
  },
  dispatch: {
    crew: "AN", incident: { number: "2026-0418-113 · 3-9-7-4-0", complaint: "Central chest pain radiating to left arm", address: "Sveavägen 112, 3 tr, Stockholm (fictional)" },
    references: { incidentNumber: "eResponse.03", complaint: "eDispatch.01", address: "eScene.15" },
    events: [
      { time: "07:51", title: "Arrived on scene", detail: "Residence — stairwell access, no lift", reference: "eTimes.07" },
      { time: "07:44", title: "Unit en route", detail: "Priority 1 response, lights and siren", reference: "eTimes.06" },
      { time: "07:42", title: "Unit notified", detail: "3-9-7-4-0 · EMD with pre-arrival instructions · lights and siren", reference: "eTimes.03 · eDispatch.02 · eDispatch.06" },
      { time: "07:40", title: "Call received", detail: "Chest pain · priority 1", reference: "eTimes.01 · eDispatch.01 · eDispatch.05" },
    ],
  },
  events: {
    note: {
      quickAction: { visible: true, label: "Add clinical note" },
      labels: {
        category: "Note", timelineTitle: "Clinical note", newEyebrow: "New timeline event", editEyebrow: "Revise timeline event",
        editorTitle: "Clinical note", closeEditor: "Close note editor", time: "Clinical time",
        timeHelp: "Correct the time if documentation was entered later.", summary: "Note summary",
        summaryPlaceholder: "Document the clinical observation or decision…", cancel: "Cancel", add: "Add to timeline", save: "Save changes",
      },
      required: { time: true, summary: true },
      references: { time: "eNarrative.01", summary: "eNarrative.01" },
      validationMessages: { invalidTime: "Enter a valid clinical time (HH:mm).", summaryRequired: "Add a clinical note before signing." },
    },
    medication: {
      quickAction: { visible: true, label: "Add medication" },
      terminology: { catalog: "nemsis-3.5.1-medications" },
      fields: [
        { id: "medication", label: "Search medications", required: true, reference: "eMedications.03", placeholder: "Try aspirin, fentanyl, saline…" },
        { id: "time", label: "Medication time", required: true, reference: "eMedications.01" },
        { id: "dose", label: "Dose", required: true, reference: "eMedications.05", placeholder: "e.g. 4" },
        { id: "unit", label: "Unit", required: true, reference: "eMedications.06" },
        { id: "route", label: "Route", required: true, reference: "eMedications.04" },
        { id: "response", label: "Patient response", required: false, reference: "eMedications.07", placeholder: "e.g. pain 8 → 4; no adverse reaction", warnWhenMissing: true },
      ],
      doseUnits: ["mg", "mcg", "g", "mL", "units", "L/min"],
      routes: ["PO — Oral", "IV — Intravenous", "IM — Intramuscular", "IN — Intranasal", "SL — Sublingual", "IO — Intraosseous", "Nebulized", "Topical"],
      labels: {
        category: "Medication", newEyebrow: "New timeline event", editEyebrow: "Revise timeline event", editorTitle: "Medication", closeEditor: "Close medication editor",
        searchResults: "Medication search results", availableOffline: "available offline", noMatches: "No medication matches your search.", change: "Change", select: "Select…", selectRoute: "Select route…",
        cancel: "Cancel", add: "Add medication", save: "Save changes", medicationMissing: "Medication not selected", routeMissing: "Route not documented", responseMissing: "Response not documented",
      },
      validationMessages: {
        invalidTime: "Enter a valid 24-hour time.", invalidMedication: "Select a medication from the NEMSIS recommended list.", invalidDose: "Dose must be a number greater than zero.",
        invalidUnit: "Select a valid configured dose unit.", invalidRoute: "Select a valid configured administration route.", responseMissing: "Medication response is not documented. You can acknowledge this warning and add it later.",
      },
    },
  },
} as const satisfies EncounterDefinition;
