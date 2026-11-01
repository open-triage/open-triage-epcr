import { commandSha256 } from "../../dist/reports/draft-report.validation.js";

/** Fictional clinical content; no production patient data. Shared by renderer tests and human PDF review. */
export function signedPdfFixture() {
  const reportId = "11111111-1111-4111-8111-111111111111";
  const snapshotId = "22222222-2222-4222-8222-222222222222";
  const signerId = "33333333-3333-4333-8333-333333333333";
  const customId = "44444444-4444-4444-8444-444444444444";
  const field = (name, sv) => ({ name, localization: { schemaVersion: 1, sv: { label: sv } },
    agencyRequired: false, minOccurs: 0, maxOccurs: null, nillable: true, supportsNotValues: true, supportsPertinentNegatives: true });
  const groups = Array.from({ length: 12 }, (_, ordinal) => ({ id: `vital-${ordinal}`, group_id: "eVitals.VitalGroup", ordinal,
    documented_time: `2026-10-19T10:${String(ordinal * 3).padStart(2, "0")}:00Z` }));
  const occurrences = [
    { id: "given", element_id: "ePatient.03", value_kind: "text", value_text: "Andrea" },
    { id: "family", element_id: "ePatient.02", value_kind: "text", value_text: "Lindqvist (FICTIONAL / FIKTIV)" },
    { id: "custom", element_id: "demo.access", element_identity_id: customId, value_kind: "text",
      value_text: "Patient requested a quiet explanation before assessment. Önskar lugn information före undersökning." },
    ...groups.flatMap((group, index) => [
      { id: `pulse-${index}`, group_instance_id: group.id, element_id: "eVitals.10", value_kind: "integer", value_integer: 88 - index },
      { id: `pressure-${index}`, group_instance_id: group.id, element_id: "eVitals.06", value_kind: "integer", value_integer: 138 - index },
    ]),
  ];
  for (const value of occurrences) Object.assign(value, { not_value_code: null, not_value_display: null,
    pertinent_negative_code: null, pertinent_negative_display: null });
  const original = structuredClone(occurrences.find((item) => item.id === "pulse-0"));
  const corrected = { ...original, value_integer: 86 };
  const source = { reportId, snapshotId, revision: 7, amendmentSequence: 1, synthetic: true, signerId, signerDisplayName: "Alex Example — fictional clinician",
    signedAt: "2026-10-19T11:00:00.000Z", catalogReleaseId: "55555555-5555-4555-8555-555555555555",
    formVersionId: "66666666-6666-4666-8666-666666666666", groups, occurrences,
    notes: [{ id: "note-1", type: "text", capturedAt: "2026-10-19T10:55:00.000Z", capturedUtcOffsetMinutes: 120,
      author: { id: signerId, displayName: "Alex Example — fictional clinician" },
      normalizedText: "Fictional test encounter. Patient describes mild dizziness after standing. No diagnosis is implied by this software test.\n\n" +
        Array.from({length: 20}, (_, i) => `Observation ${i + 1}: Patient remained alert during this fictional assessment. Reported symptoms and the clinician’s authored wording are preserved, including Å, Ä, Ö, é, μ and ≥.\n`).join("") +
        "\nFINAL CLINICAL NOTE SENTINEL — Slut på den långa anteckningen." }],
    amendments: [{ id: "77777777-7777-4777-8777-777777777777", sequence: 1, authorId: signerId,
      signedAt: "2026-10-19T11:10:00.000Z", reason: "Corrected transcription of the first pulse from 88 to 86. Original observation retained in amendment provenance.",
      canonicalSha256: "b".repeat(64), changes: [{ action: "replace", targetId: original.id, original, corrected }] }],
    configuration: { definition: { schemaVersion: 1, sections: [] },
      catalogFields: { "ePatient.02": field("Family name", "Efternamn"), "ePatient.03": field("Given name", "Förnamn"),
        "eVitals.10": field("Pulse rate (beats/min)", "Puls (slag/min)"), "eVitals.06": field("Systolic blood pressure (mmHg)", "Systoliskt blodtryck (mmHg)") },
      catalogGroups: { "eVitals.VitalGroup": { name: "Vital signs", localization: { schemaVersion: 1, sv: { name: "Vitalparametrar" } } } },
      customFields: { [customId]: { id: customId, namespace: "demo", slug: "access", title: "Patient communication needs",
        localization: { schemaVersion: 1, sv: { label: "Patientens kommunikationsbehov" } }, datatype: "string" } } } };
  const manifest = { schemaVersion: 1, clinicalContentVersion: 2, report: { id: reportId, revision: source.revision,
    formVersionId: source.formVersionId, catalogReleaseId: source.catalogReleaseId, signer: { id: signerId, displayName: source.signerDisplayName } }, groups, occurrences, notes: source.notes };
  source.canonicalSha256 = commandSha256(manifest);
  return { source, manifest };
}
