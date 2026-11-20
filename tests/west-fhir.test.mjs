import assert from "node:assert/strict";
import test from "node:test";
import { buildWestFhirBundle, buildWestFhirFromEncounter } from "../scripts/generate-west-fhir.mjs";
import { shippedWestDefinition, westFhirMapping as mapping } from "../defines/decision_support/west-localization.mjs";
import { decisionSupportPickerCategories, decisionSupportCategoryCriteria, isSelectableDecisionSupportCriterion } from "@open-triage/contracts";
import source from "../packages/contracts/fhir/west-a/assessment.example.json" with { type: "json" };
import patient from "../packages/contracts/examples/hospital/arne-patient.json" with { type: "json" };
import example from "../packages/contracts/fhir/west-a/bundle.example.json" with { type: "json" };

const west = shippedWestDefinition("en");
const profile = (bundle, name) => bundle.entry.find(({ resource }) => resource.meta?.profile?.includes(
  mapping.canonical + "/StructureDefinition/west-a-" + name))?.resource;

test("each selectable WEST finding maps to the public package; the checked-in bundle is reproducible", () => {
  assert.ok(!Object.hasOwn(west, "fhir"), "Exchange metadata must not change pinned clinical snapshots");
  const ids = decisionSupportPickerCategories(west.categories).flatMap(category =>
    decisionSupportCategoryCriteria(category).filter(({ criterion }) => isSelectableDecisionSupportCriterion(criterion))
      .map(({ criterion }) => criterion.id));
  assert.deepEqual([...ids].sort(), Object.keys(mapping.criterion).sort());
  assert.deepEqual(buildWestFhirBundle(source, patient), example);
  assert.deepEqual(buildWestFhirBundle({ ...source, definitionVersion: "1.0.0-draft.5" }, patient), example);
  const oidPatient = { ...patient, identifier: [{ ...patient.identifier[0], system: "urn:oid:1.2.752.129.2.1.3.1" }] };
  assert.deepEqual(buildWestFhirBundle(source, oidPatient), example);
  const score = profile(example, "news2-observation");
  const triage = profile(example, "triage-observation");
  assert.equal(score.valueInteger, 5);
  assert.equal(score.derivedFrom.length, 7);
  assert.equal(triage.valueCodeableConcept.coding[0].code, "2");
  assert.deepEqual(triage.component.map(item => item.valueCodeableConcept.coding[0].code), ["4", "15"]);
  const urls = new Set(example.entry.map(entry => entry.fullUrl));
  for (const entry of example.entry) {
    for (const reference of [entry.resource.subject, entry.resource.encounter, ...entry.resource.derivedFrom ?? []].filter(Boolean))
      assert.ok(urls.has(reference.reference), reference.reference);
  }
});

test("export preserves oxygen and negative finding scope, partial scores and manual priority", () => {
  const make = update => buildWestFhirBundle({ ...source, ...update }, patient);
  const copd = make({ scale: "copd", observations: { oxygen: "supplemental", consciousness: "A" } });
  assert.equal(profile(copd, "supplemental-oxygen"), undefined);
  assert.ok(profile(copd, "news2-observation").component.some(item => item.code.coding[0].code === "1104321000000108"));
  const partial = make({ measurements: {}, observations: {} });
  assert.equal(profile(partial, "news2-observation"), undefined);
  assert.match(profile(partial, "triage-observation").note[0].text, /Provisional/);
  assert.equal(profile(make({ scale: "obstetric" }), "news2-observation"), undefined);
  assert.throws(() => make({ primaryCategory: "admission" }), /primary WEST complaint/);
  const negatives = make({ primaryCategory: "gynaecology.01", findings: { criteria: ["gynaecology.01.none"], noWarningCriteria: false } });
  assert.equal(profile(negatives, "triage-observation").component.length, 1);
  const manual = make({ override: { colour: "green", enteredBy: "synthetic", enteredAt: source.measurementInstant,
    calculatedColourWhenSelected: "orange" } });
  assert.equal(profile(manual, "triage-observation").valueCodeableConcept.coding[0].code, "4");
  assert.match(profile(manual, "triage-observation").note[0].text, /Calculated: orange/);
});

test("a finalized canonical vital group reproduces the validated bundle using only that measurement", async () => {
  await import("tsx");
  const { getNemsisDataElement } = await import("../apps/web/app/nemsis-data-model.ts");
  const { withVitalDecisionSupport, vitalAssessmentWithFindings } = await import("../apps/web/app/vital-decision-support.ts");
  const fields = Object.fromEntries(Object.keys(west.assessment.elements).map(name => [name, {
    namespace: "west.opentriage.org", slug: name, datatype: "coded", choices: [], codeSystem: "https://opentriage.org/codes/west-a-2025/" + name,
  }]));
  const configuration = { definition: west, fields };
  const root = { instanceId: source.measurementId, elements: [] };
  const groups = new Map([[west.assessment.group, root]]);
  for (const [id, value] of Object.entries({ "eVitals.01": source.measurementInstant, ...source.measurements })) {
    const group = getNemsisDataElement(id).groupPath.at(-1);
    if (!groups.has(group)) groups.set(group, { instanceId: group, parentInstanceId: root.instanceId, elements: [] });
    groups.get(group).elements.push({ id, values: [{ kind: "scalar", value, occurrenceId: id }] });
  }
  const assessment = vitalAssessmentWithFindings({ scale: source.scale, findings: source.findings, observations: source.observations,
    override: null }, west, "10:35", source.measurements);
  groups.set(west.assessment.group, withVitalDecisionSupport(root, configuration, assessment));
  const document = { encounter: { id: source.encounterId }, groups: Array.from(groups, ([id, row]) => ({ id, instances: [row] })) };
  document.groups.find(group => group.id === "eVitals.BloodPressureGroup").instances.unshift({
    instanceId: "other-bp", parentInstanceId: "different-measurement",
    elements: [{ id: "eVitals.06", values: [{ kind: "scalar", value: 50 }] }],
  });
  const input = { document, configuration, measurementId: root.instanceId, context: {
    patientId: source.patientId, resourceBase: source.resourceBase, primaryCategory: source.primaryCategory, performer: source.performer,
    encounterStatus: source.encounterStatus, encounterClass: source.encounterClass,
  } };
  assert.deepEqual(await buildWestFhirFromEncounter(input, patient), example);
  const { demoRecordBundle } = await import("../scripts/generate-demo-record-fhir.mjs");
  const report = { id: source.encounterId, status: "draft", demoMutable: true, revision: 3, document,
    notes: [{ type: "text", content: "Fictional demo note" }], clinicalForm: { decisionSupport: configuration } };
  document.groups.push({ id: "ePatient.PatientGroup", instances: [{ instanceId: "patient", elements: [
    { id: "ePatient.01", values: [{ kind: "scalar", value: "demo-patient" }] },
  ] }] });
  const demo = await demoRecordBundle(report);
  assert.deepEqual(demo.issues, []);
  assert.equal(demo.assessments, 1);
  const demoPerformerUrl = "https://example.org/opentriage-demo/fhir/Practitioner/synthetic-registrar";
  const observations = demo.bundle.entry.filter(({ resource }) => resource.resourceType === "Observation");
  assert.equal(observations.length, 9);
  for (const { resource } of observations) assert.deepEqual(resource.performer, [{ reference: demoPerformerUrl }]);
  assert.equal(profile(demo.bundle, "triage-observation").valueCodeableConcept.coding[0].code, "2");
  const attachment = demo.bundle.entry.find(entry => entry.resource.resourceType === "DocumentReference").resource.content[0].attachment;
  assert.deepEqual(JSON.parse(Buffer.from(attachment.data, "base64")), { document: JSON.parse(JSON.stringify(document)), notes: report.notes });
  const repeat = structuredClone(report);
  const repeatedGroups = repeat.document.groups.filter(group => group.id.startsWith("eVitals."));
  for (const group of repeatedGroups) {
    const extra = structuredClone(group.instances).filter(row => row.parentInstanceId !== "different-measurement");
    for (const row of extra) {
      row.instanceId += "-2";
      if (row.parentInstanceId) row.parentInstanceId += "-2";
    }
    group.instances.push(...extra);
  }
  const multiple = await demoRecordBundle(repeat);
  assert.deepEqual(multiple.issues, []);
  assert.equal(multiple.assessments, 2);
  assert.equal(multiple.bundle.entry.filter(({ resource }) => resource.resourceType === "Patient").length, 1);
  assert.equal(multiple.bundle.entry.filter(({ resource }) => resource.meta?.profile?.includes(mapping.canonical + "/StructureDefinition/west-a-triage-observation")).length, 2);
  const generated = structuredClone(repeat);
  const demoAttributes = { "x-open-triage-demo": "stationary-populate-v1" };
  for (const group of generated.document.groups) for (const row of group.instances) {
    row.attributes = demoAttributes;
    for (const element of row.elements) for (const value of element.values) value.attributes = { ...value.attributes, ...demoAttributes };
  }
  const editedPressure = generated.document.groups.find(group => group.id === "eVitals.BloodPressureGroup")
    .instances.find(row => row.parentInstanceId === root.instanceId + "-2");
  editedPressure.elements[0].values[0].attributes = { "x-open-triage-owner": "clinician" };
  const exported = await demoRecordBundle(generated);
  const practitioners = exported.bundle.entry.filter(({ resource }) => resource.resourceType === "Practitioner");
  assert.equal(practitioners.length, 1);
  assert.equal(practitioners[0].fullUrl, demoPerformerUrl);
  assert.equal(exported.assessments, 2);
  for (const { resource } of exported.bundle.entry.filter(({ resource }) => resource.resourceType === "Observation")) {
    assert.deepEqual(resource.performer, [{ reference: demoPerformerUrl }]);
  }
  const empty = await demoRecordBundle({ ...report, document: { ...document, groups: [] } });
  assert.equal(empty.assessments, 0);
  assert.equal(empty.issues[0].severity, "warning");
  await assert.rejects(demoRecordBundle({ ...report, demoMutable: false }));
  const saved = groups.get(west.assessment.group).decisionSupportCalculation;
  saved.physiology.total++;
  await assert.rejects(buildWestFhirFromEncounter(input, patient), /saved calculation/);
});
