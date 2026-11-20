import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { decisionSupportFindingCategories } from "@open-triage/contracts";
import { westFhirMapping } from "../defines/decision_support/west-localization.mjs";
import { vitalDecisionSupport } from "../apps/web/app/vital-decision-support.ts";
import { buildWestFhirFromEncounter, narrative } from "./generate-west-fhir.mjs";

const demoPerformer = { resourceType: "Practitioner", id: "synthetic-registrar", name: [{ text: "Example ambulance clinician" }] };

/** Build a collection for the saved demo revision, preserving the original ePCR alongside its WEST observations. */
export async function demoRecordBundle(report) {
  assert.ok(report.demoMutable && report.status === "draft");
  const { document } = report;
  const configuration = report.clinicalForm?.decisionSupport;
  const base = "https://example.org/opentriage-demo/fhir/";
  const ref = (type, id) => base + type + "/" + id;
  const patientField = id => document.groups.flatMap(group => group.instances)
    .flatMap(row => row.elements).find(element => element.id === id)?.values[0];
  const scalar = id => {
    const field = patientField(id);
    return field?.kind === "scalar" ? String(field.value) : undefined;
  };
  const family = scalar("ePatient.02");
  const given = [scalar("ePatient.03"), scalar("ePatient.04")].filter(Boolean);
  const identifier = scalar("ePatient.01");
  const patient = { resourceType: "Patient", id: report.id, text: narrative([family, ...given].filter(Boolean).join(" ") || "Demo patient"),
    ...(identifier ? { identifier: [{ system: "urn:opentriage:demo:patient", value: identifier }] } : {}),
    ...(family || given.length ? { name: [{ family, ...(given.length ? { given } : {}) }] } : {}),
    birthDate: scalar("ePatient.17") };
  const subject = { reference: ref("Patient", patient.id) };
  const encounter = { resourceType: "Encounter", id: document.encounter.id, status: "in-progress", text: narrative("Open prehospital encounter " + document.encounter.id),
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "EMER" }, subject };
  const record = { resourceType: "DocumentReference", id: report.id, status: "current", subject,
    text: narrative("OpenTriage ePCR, saved revision " + report.revision),
    context: { encounter: [{ reference: ref("Encounter", encounter.id) }] },
    content: [{ attachment: { contentType: "application/json", title: "OpenTriage ePCR",
      data: Buffer.from(JSON.stringify({ document, notes: report.notes ?? [] })).toString("base64") } }] };
  const entries = new Map();
  const add = resource => entries.set(ref(resource.resourceType, resource.id), resource);
  [patient, encounter, record].forEach(add);
  const issues = [];
  let assessments = 0;
  const rows = document.groups.find(group => group.id === "eVitals.VitalGroup")?.instances ?? [];
  for (const row of rows.filter(row => row.decisionSupportCalculation)) {
    try {
      assert.ok(configuration, "Saved WEST measurement has no pinned definition");
      const assessment = vitalDecisionSupport(row, configuration);
      const categories = decisionSupportFindingCategories(configuration.definition, assessment.findings?.criteria ?? [])
        .map(({ category }) => category.id).filter(id => Object.hasOwn(westFhirMapping.complaint, id));
      const primaryCategory = categories.length === 1 ? categories[0] : undefined;
      if (!primaryCategory) issues.push({ severity: "error", code: "required",
        diagnostics: row.instanceId + ": A single primary WEST complaint could not be identified." });
      const bundle = await buildWestFhirFromEncounter({ document, configuration, measurementId: row.instanceId,
        context: { resourceBase: base, patientId: patient.id, primaryCategory, performer: demoPerformer,
          encounterStatus: encounter.status, encounterClass: encounter.class.code } }, patient, { includeIncomplete: true });
      for (const entry of bundle.entry) add(entry.resource);
      assessments++;
    } catch (error) {
      issues.push({ severity: "error", code: "processing", diagnostics: row.instanceId + ": " + error.message.split("\n")[0] });
    }
  }
  if (!rows.some(row => row.decisionSupportCalculation)) {
    issues.push({ severity: "warning", code: "incomplete", diagnostics: "This record has no finalized WEST assessment." });
  }
  return { bundle: { resourceType: "Bundle", type: "collection",
    entry: Array.from(entries, ([fullUrl, resource]) => ({ fullUrl, resource })) }, issues, assessments };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await demoRecordBundle(JSON.parse(await readFile(process.argv[2], "utf8")));
  await writeFile(process.argv[3], JSON.stringify(result.bundle));
  await writeFile(process.argv[4], JSON.stringify({ issues: result.issues, assessments: result.assessments }));
}
