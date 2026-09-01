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
    vitals: {
      quickAction: { visible: true, label: "Add vital signs" },
      labels: {
        category: "Vital", timelineTitle: "Vital signs", newEyebrow: "New timeline event", editEyebrow: "Revise timeline event",
        editorTitle: "Vital signs", closeEditor: "Close vital signs editor", time: "Clinical time",
        absenceHelp: "Unavailable and pertinent-negative choices vary by field.", cancel: "Cancel", add: "Add vital set", save: "Save changes",
        absentSummary: "not recorded",
      },
      references: { group: "eVitals.VitalGroup", time: "eVitals.01" },
      validationMessages: { invalidTime: "eVitals.01 requires a valid clinical time (HH:mm).", emptyGroup: "eVitals.VitalGroup requires at least one documented vital element." },
      fields: [
        { id: "systolic", label: "Systolic BP", unit: "mmHg", required: true, reference: "eVitals.06", boundaries: { min: 0, max: 500, warningLow: 70, warningHigh: 220 }, absenceStates: [
          { code: "7701001", kind: "NV", label: "Not applicable (NV)" }, { code: "7701003", kind: "NV", label: "Not recorded (NV)" },
          { code: "8801005", kind: "PN", label: "Finding not present (PN)" }, { code: "8801019", kind: "PN", label: "Refused (PN)" }, { code: "8801023", kind: "PN", label: "Unable to complete (PN)" },
        ] },
        { id: "diastolic", label: "Diastolic BP", unit: "mmHg", required: true, reference: "eVitals.07", boundaries: { min: 0, max: 500, warningLow: 40, warningHigh: 130 }, absenceStates: [
          { code: "7701001", kind: "NV", label: "Not applicable (NV)" }, { code: "7701003", kind: "NV", label: "Not recorded (NV)" }, { code: "7701005", kind: "NV", label: "Not reporting (NV)" },
          { code: "8801005", kind: "PN", label: "Finding not present (PN)" }, { code: "8801019", kind: "PN", label: "Refused (PN)" }, { code: "8801023", kind: "PN", label: "Unable to complete (PN)" },
        ] },
        { id: "heartRate", label: "Heart rate", unit: "bpm", required: true, reference: "eVitals.10", boundaries: { min: 0, max: 500, warningLow: 40, warningHigh: 180 }, absenceStates: [
          { code: "7701001", kind: "NV", label: "Not applicable (NV)" }, { code: "7701003", kind: "NV", label: "Not recorded (NV)" },
          { code: "8801005", kind: "PN", label: "Finding not present (PN)" }, { code: "8801019", kind: "PN", label: "Refused (PN)" }, { code: "8801023", kind: "PN", label: "Unable to complete (PN)" },
        ] },
        { id: "spo2", label: "SpO₂", unit: "%", required: false, reference: "eVitals.12", boundaries: { min: 0, max: 100, warningLow: 90, warningHigh: 100 }, absenceStates: [
          { code: "7701001", kind: "NV", label: "Not applicable (NV)" }, { code: "7701003", kind: "NV", label: "Not recorded (NV)" },
          { code: "8801005", kind: "PN", label: "Finding not present (PN)" }, { code: "8801019", kind: "PN", label: "Refused (PN)" }, { code: "8801023", kind: "PN", label: "Unable to complete (PN)" },
        ] },
        { id: "respiratoryRate", label: "Respiratory rate", unit: "breaths/min", required: false, reference: "eVitals.14", boundaries: { min: 0, max: 300, warningLow: 8, warningHigh: 35 }, absenceStates: [
          { code: "7701001", kind: "NV", label: "Not applicable (NV)" }, { code: "7701003", kind: "NV", label: "Not recorded (NV)" },
          { code: "8801005", kind: "PN", label: "Finding not present (PN)" }, { code: "8801019", kind: "PN", label: "Refused (PN)" }, { code: "8801023", kind: "PN", label: "Unable to complete (PN)" },
        ] },
        { id: "gcs", label: "GCS total", unit: "score", required: false, reference: "eVitals.21", boundaries: { min: 3, max: 15, warningLow: 12, warningHigh: 15 }, absenceStates: [
          { code: "7701001", kind: "NV", label: "Not applicable (NV)" }, { code: "7701003", kind: "NV", label: "Not recorded (NV)" },
          { code: "8801019", kind: "PN", label: "Refused (PN)" }, { code: "8801023", kind: "PN", label: "Unable to complete (PN)" },
        ] },
        { id: "pain", label: "Pain score", unit: "score", required: false, reference: "eVitals.27", boundaries: { min: 0, max: 10, warningLow: 0, warningHigh: 7 }, absenceStates: [
          { code: "7701001", kind: "NV", label: "Not applicable (NV)" }, { code: "7701003", kind: "NV", label: "Not recorded (NV)" },
          { code: "8801019", kind: "PN", label: "Refused (PN)" }, { code: "8801023", kind: "PN", label: "Unable to complete (PN)" },
        ] },
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
