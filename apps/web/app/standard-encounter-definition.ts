import type { EncounterDefinition } from "./encounter-definition";

export const standardEncounterDefinition = {
  schemaVersion: 1, id: "standard-encounter-v1", version: 1, synthetic: true,
  dates: { clinicalDate: "2026-04-18", currentTime: "07:51" },
  labels: { prototypeStatus: "Prototype", incident: "Incident", patientDialogEyebrow: "Quick patient details", patientDialogTitle: "Patient information", patientName: "Patient name", age: "Age", sex: "Sex", medicalHistory: "Medical history", currentMedications: "Current medications", allergies: "Medication allergies", savePatient: "Save patient" },
  patient: {
    quickAction: { visible: true, label: "Edit patient information", title: "Patient information" },
    initial: { name: "Rivera, Jordan", age: 54, sex: "X", identifier: "SYNTHETIC-0001", medicalHistory: [], currentMedications: [], allergies: [] },
    references: { name: "ePatient.02", age: "ePatient.15", sex: "ePatient.13", identifier: "ePatient.01" },
    choices: {
      medicalHistory: ["Hypertension", "Diabetes", "COPD / chronic lung disease", "Stroke / TIA", "Seizure disorder", "No known medical history"].map((label) => ({ label, reference: "eHistory.08" as const })),
      currentMedications: ["Antihypertensive", "Anticoagulant", "Insulin", "Inhaler", "No current medications"].map((label) => ({ label, reference: "eHistory.12" as const })),
      allergies: [...["Penicillin", "Sulfonamides", "NSAIDs", "Opioids"].map((label) => ({ label, reference: "eHistory.06" as const })), { label: "No known drug allergies", reference: "eHistory.06 PN" }],
    },
  },
  dispatch: {
    crew: "AN", incident: { number: "SYN-2026-0418-113 · 3-9-7-4-0", complaint: "Medical assistance requested", address: "100 Example Avenue, Unit 3 (fictional)" },
    references: { incidentNumber: "eResponse.03", complaint: "eDispatch.01", address: "eScene.15" },
    events: [
      { time: "07:51", title: "Arrived on scene", detail: "Fictional residence — standard access", reference: "eTimes.07" },
      { time: "07:44", title: "Unit en route", detail: "Routine response", reference: "eTimes.06" },
      { time: "07:42", title: "Unit notified", detail: "3-9-7-4-0 · fictional dispatch notification", reference: "eTimes.03 · eDispatch.02 · eDispatch.06" },
      { time: "07:40", title: "Call received", detail: "Medical assistance requested", reference: "eTimes.01 · eDispatch.01 · eDispatch.05" },
    ],
  },
  composition: {
    quickActionOrder: ["vitals", "medication", "procedure", "note", "patient"],
    review: {
      groups: [
        { severity: "error", title: "Blocking errors", empty: "No blocking errors." },
        { severity: "warning", title: "Warnings to acknowledge", empty: "No warnings." },
      ],
      eventTypeOrder: ["vitals", "medication", "procedure", "note"],
    },
    summary: { eventTypeOrder: ["vitals", "medication", "procedure", "note"] },
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
    procedure: {
      quickAction: { visible: true, label: "Add procedure" },
      fieldOrder: ["procedure", "time", "attempts", "success", "outcome", "complications"],
      labels: {
        category: "Procedure", newEyebrow: "New treatment event", editEyebrow: "Edit canonical event", editorTitle: "Procedure",
        closeEditor: "Close procedure editor", search: "Search procedures", searchPlaceholder: "Try ECG, IV, oxygen…",
        offlineCaption: "shown · available offline", noResults: "No procedure matches all search terms.", change: "Change",
        procedure: "Procedure", time: "Procedure time", attempts: "Attempts", success: "Successful", outcome: "Patient response",
        complications: "Complications", select: "Select…", cancel: "Cancel", add: "Add procedure", save: "Save changes",
        warningPill: "⚠ Warning: review needed",
      },
      terminology: { catalog: "nemsis-procedures-3.5.1", codeSystem: "SNOMED CT" },
      required: { procedure: true, time: true, attempts: true, success: true, outcome: true, complications: true },
      references: { procedure: "eProcedures.03", time: "eProcedures.01", attempts: "eProcedures.05", success: "eProcedures.06", complications: "eProcedures.07", outcome: "eProcedures.08" },
      attempts: { defaultValue: 1, min: 1, max: 10 },
      successOptions: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      outcomeOptions: [
        { value: "improved", code: "9916001", label: "Improved" }, { value: "unchanged", code: "9916003", label: "Unchanged" },
        { value: "worse", code: "9916005", label: "Worse" }, { value: "not-applicable", code: "7701001", label: "Not applicable" },
      ],
      complicationOptions: [
        ["3907001", "Altered mental status"], ["3907003", "Apnea"], ["3907033", "None"], ["3907005", "Bleeding"], ["3907007", "Bradypnea"],
        ["3907047", "Bradycardia"], ["3907009", "Diarrhea"], ["3907011", "Esophageal intubation—immediately"], ["3907013", "Esophageal intubation—other"],
        ["3907015", "Extravasation"], ["3907017", "Hypertension"], ["3907019", "Hyperthermia"], ["3907021", "Hypotension"], ["3907023", "Hypothermia"],
        ["3907025", "Hypoxia"], ["3907027", "Injury"], ["3907031", "Nausea"], ["3907035", "Other"], ["3907039", "Respiratory distress"],
        ["3907041", "Tachycardia"], ["3907043", "Tachypnea"], ["3907045", "Vomiting"], ["3907049", "Itching"], ["3907051", "Urticaria"],
      ].map(([code, label]) => ({ code: code!, label: label! })),
      validationMessages: {
        procedureRequired: "Select a procedure from the pinned NEMSIS list.", labelMismatch: "The display label must match the selected SNOMED CT code.",
        invalidTime: "Enter the procedure time as HH:mm.", invalidAttempts: "Attempts must be a whole number from 1 to 10.",
        successRequired: "Record whether the procedure was successful.", complicationsRequired: "Select None or at least one complication.",
        outcomeRequired: "Record the patient's response to the procedure.",
      },
      warningBehavior: {
        noneCode: "3907033", repeatedAttemptThreshold: 1,
        noneWithOtherMessage: "nemSch_e158: “None” should not be recorded with another procedure complication.",
        repeatedOrUnsuccessfulMessage: "Standard encounter warning: Review whether a complication should be documented for repeated or unsuccessful attempts.",
      },
      timeline: { attemptSingular: "attempt", attemptPlural: "attempts", successful: "successful", unsuccessful: "unsuccessful", complicationLabel: "Complication" },
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
