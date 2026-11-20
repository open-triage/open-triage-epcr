import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateDecisionSupportFindings, decisionSupportCriterionAvailable, decisionSupportFindingCategories,
  decisionSupportFindingResult, decisionSupportMeasurementLocalTime, decisionSupportPhysiology,
  effectiveDecisionSupportColour, isTriageColour, SWEDISH_PATIENT_IDENTIFIER_NAMESPACES,
} from "@open-triage/contracts";
import { shippedWestDefinition, westFhirMapping as map } from "../defines/decision_support/west-localization.mjs";

const definition = shippedWestDefinition("en");
const snomed = "http://snomed.info/sct";
const loinc = "http://loinc.org";
const ucum = "http://unitsofmeasure.org";
const system = (name) => `${map.canonical}/CodeSystem/west-a-${name}-cs`;
const profile = (name) => ({ profile: [`${map.canonical}/StructureDefinition/west-a-${name}`] });
const coded = (system, code) => ({ coding: [{ system, code,
  ...(system === snomed ? { version: "http://snomed.info/sct/45991000052106" } : {}) }] });
const quantity = (value, code) => ({ value, unit: { Cel: "°C", "mm[Hg]": "mmHg" }[code] ?? code, system: ucum, code });
const acvpu = { A: "248234008", C: "130987000", V: "300202002", P: "450847001", U: "422768004" };
const scoreCodes = {
  respiratoryRate: "1104301000000104", spo2: "1104311000000102", oxygen: "1104331000000105",
  systolic: "1104341000000101", heartRate: "1104351000000103", consciousness: "1104361000000100",
  temperature: "1104371000000107",
};
const nationalIdentifiers = new Map([
  [SWEDISH_PATIENT_IDENTIFIER_NAMESPACES.personal, "http://electronichealth.se/identifier/personnummer"],
  [SWEDISH_PATIENT_IDENTIFIER_NAMESPACES.coordination, "http://electronichealth.se/identifier/samordningsnummer"],
]);

export function narrative(summary) {
  const escaped = String(summary).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escaped}</p></div>` };
}

function reading(source, key) {
  const input = definition.inputs[key];
  const raw = source.measurements[input.element];
  if (raw == null || raw === "" || (key === "diastolic" && raw === "P")) return;
  assert.match(String(raw), /^[+-]?\d+(?:[.,]\d+)?$/, `Invalid measurement for ${key}`);
  const number = Number(String(raw).replace(",", "."));
  assert.ok(number >= input.minValue && number <= input.maxValue && Number(number.toFixed(input.precision)) === number,
    `Out-of-range or excess precision for ${key}`);
  return number;
}

export function buildWestFhirBundle(source, patient, { includeIncomplete = false } = {}) {
  const baseUrl = new URL(source.resourceBase);
  assert.ok(["https:", "http:"].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password &&
    !baseUrl.search && !baseUrl.hash, "Supply a FHIR resource base URL");
  const ref = resource => ({ reference: baseUrl.href.replace(/\/?$/, "/") + resource.resourceType + "/" + resource.id });
  assert.equal(source.definitionKey, definition.key);
  // Drafts 5 and 6 have identical clinical rules and exchange mappings.
  assert.ok(["1.0.0-draft.5", "1.0.0-draft.6"].includes(source.definitionVersion), "Unsupported WEST definition version");
  assert.ok(Object.hasOwn(definition.assessment.elements.newsScale.values, source.scale), "Unknown WEST scale");
  assert.ok((includeIncomplete && !source.primaryCategory) || Object.hasOwn(map.complaint, source.primaryCategory), "An explicit primary WEST complaint is required");
  assert.match(source.measurementId, /^[A-Za-z0-9.-]{1,44}$/);
  for (const id of [source.patientId, source.encounterId]) assert.match(id, /^[A-Za-z0-9.-]{1,64}$/);
  assert.match(source.measurementInstant, /^\d{4}-\d\d-\d\dT(\d\d:\d\d):\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/);
  assert.ok(Number.isFinite(Date.parse(source.measurementInstant)));
  const localTime = source.utcOffsetMinutes == null ? source.measurementInstant.slice(11, 16)
    : decisionSupportMeasurementLocalTime(source.measurementInstant, source.utcOffsetMinutes);
  const findings = decisionSupportFindingResult(definition, source.findings, localTime);
  assert.ok(findings.valid, "Invalid WEST findings");
  const { oxygen, consciousness } = source.observations;
  assert.ok(oxygen == null || definition.inputs.oxygen.values.includes(oxygen), "Invalid oxygen status");
  assert.ok(consciousness == null || Object.hasOwn(acvpu, consciousness), "Invalid ACVPU code");
  const physiology = decisionSupportPhysiology(definition, source.scale, source.measurements, source.observations);
  const calculated = calculateDecisionSupportFindings(definition, findings, physiology);
  if (source.savedCalculation) assert.deepEqual(calculated, source.savedCalculation,
    "The saved calculation does not match this measurement and pinned clinical definition");
  const manual = source.override;
  assert.ok(!manual || (isTriageColour(manual.colour) && manual.enteredBy && manual.enteredAt), "Incomplete override");
  const effective = effectiveDecisionSupportColour(calculated, manual?.colour);
  assert.ok(effective, "Unassessed measurement has no triage colour to exchange");

  assert.equal(patient.resourceType, "Patient");
  if (patient.id) assert.equal(source.patientId, patient.id, "Patient context and supplied Patient.id differ");
  assert.ok(includeIncomplete || patient.identifier?.length, "A WEST patient requires an identifier");
  const security = patient.meta?.security;
  const subject = { resourceType: "Patient", id: source.patientId, meta: { ...profile("patient"), ...(security ? { security } : {}) },
    text: narrative(patient.name?.[0]?.text ?? patient.name?.[0]?.family ?? source.patientId),
    identifier: patient.identifier?.map(id => ({ ...id, system: nationalIdentifiers.get(id.system) ?? id.system })),
    name: patient.name, gender: patient.gender, birthDate: patient.birthDate };
  assert.ok(source.encounterClass && source.encounterStatus, "Supply the documented encounter class and status");
  const encounter = { resourceType: "Encounter", id: source.encounterId, status: source.encounterStatus,
    text: narrative(`Encounter ${source.encounterId}, ${source.encounterStatus}.`),
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: source.encounterClass }, subject: ref(subject) };
  const resources = [subject, encounter];
  if (source.performer) {
    assert.equal(source.performer.resourceType, "Practitioner");
    assert.match(source.performer.id, /^[A-Za-z0-9.-]{1,64}$/);
    resources.push({ ...source.performer, text: source.performer.text ?? narrative(source.performer.name?.[0]?.text ?? source.performer.id) });
  }
  function observation(name, category, code, values, summary) {
    const resource = { resourceType: "Observation", id: source.measurementId + "-" + name, meta: profile(name),
      status: "final", category: [coded("http://terminology.hl7.org/CodeSystem/observation-category", category)],
      text: narrative(summary), ...(source.performer ? { performer: [ref(source.performer)] } : {}),
      code, subject: ref(subject), encounter: ref(encounter), effectiveDateTime: source.measurementInstant, ...values };
    resources.push(resource);
    return resource;
  }

  for (const [key, name, term, unit] of [
    ["respiratoryRate", "respiratory-rate", "9279-1", "/min"], ["spo2", "oxygen-saturation", "2708-6", "%"],
    ["heartRate", "heart-rate", "8867-4", "/min"], ["temperature", "body-temperature", "8310-5", "Cel"],
  ]) {
    const value = reading(source, key);
    if (value !== undefined) observation(name, "vital-signs", coded(loinc, term), { valueQuantity: quantity(value, unit) },
      `${name.replaceAll("-", " ")}: ${value} ${quantity(value, unit).unit}`);
  }
  const pressures = [reading(source, "systolic"), reading(source, "diastolic")];
  if (pressures.some(value => value !== undefined)) {
    observation("blood-pressure", "vital-signs", coded(loinc, "85354-9"), {
      component: pressures.map((value, index) => ({ code: coded(loinc, ["8480-6", "8462-4"][index]),
        ...(value !== undefined ? { valueQuantity: quantity(value, "mm[Hg]") }
          : { dataAbsentReason: coded("http://terminology.hl7.org/CodeSystem/data-absent-reason", "unknown") }) })),
    }, `Blood pressure: ${pressures[0] ?? "unknown"}/${pressures[1] ?? "unknown"} mmHg`);
  }
  if (consciousness) observation("consciousness", "exam", coded(snomed, "1104441000000107"), {
    valueCodeableConcept: coded(snomed, acvpu[consciousness]),
  }, `Consciousness (ACVPU): ${consciousness}`);
  const flow = source.oxygenFlowLPerMinute;
  assert.ok(flow == null || (Number.isFinite(flow) && ((oxygen === "air" && flow === 0) ||
    (oxygen === "supplemental" && flow > 0))), "Oxygen flow conflicts with the recorded oxygen status");
  if (oxygen === "air" || flow != null) observation("supplemental-oxygen", "therapy", coded(snomed, "427081008"),
    { valueQuantity: quantity(flow ?? 0, "L/min") }, `Oxygen flow: ${flow ?? 0} L/min`);

  const vitals = resources.filter(resource => resource.resourceType === "Observation").map(ref);
  const notes = [];
  if (oxygen === "supplemental" && flow == null) notes.push("Supplemental oxygen documented; flow rate unavailable.");
  let basis = vitals;
  if (source.scale === "obstetric") {
    notes.push(physiology.total == null ? "Obstetric ONEWS2 incomplete." : `Obstetric ONEWS2 total: ${physiology.total}.`);
  } else if (physiology.total != null) {
    const score = observation("news2-observation", "survey", coded(snomed, "1104051000000101"), {
      valueInteger: physiology.total, derivedFrom: vitals,
      component: Object.entries(physiology.points).map(([key, valueInteger]) => ({
        code: coded(snomed, key === "spo2" && source.scale === "copd" ? "1104321000000108" : scoreCodes[key]), valueInteger,
      })),
    }, `NEWS2: ${physiology.total}, oxygen saturation scale ${source.scale === "copd" ? 2 : 1}.`);
    basis = [ref(score)];
  }

  const component = source.primaryCategory ? [{ code: coded(snomed, "1269489004"),
    valueCodeableConcept: coded(system("chief-complaint"), map.complaint[source.primaryCategory]) }] : [];
  const criteria = new Set();
  const findingText = [];
  let noWarning = source.findings.noWarningCriteria;
  const selections = decisionSupportFindingCategories(definition, source.findings.criteria);
  for (const { category, criteria: selected } of selections) {
    for (const { criterion } of selected) {
      assert.ok(decisionSupportCriterionAvailable(definition, criterion, localTime), `Criterion outside its applicable time: ${criterion.id}`);
      findingText.push(criterion.displayLabel ?? criterion.text);
    }
    if (category.id !== source.primaryCategory) notes.push(`Additional assessed WEST category: ${category.displayLabel ?? category.category}.`);
  }
  for (const selection of source.findings.criteria) {
    if (selection.endsWith(".none")) {
      const category = selection.slice(0, -5);
      if (category === source.primaryCategory && !category.startsWith("gynaecology.")) noWarning = true;
      else notes.push(`No criteria met in local WEST category ${category}.`);
    } else {
      assert.ok(Object.hasOwn(map.criterion, selection), `Unmapped finding: ${selection}`);
      criteria.add(map.criterion[selection]);
    }
  }
  if (noWarning) criteria.add(map.noWarning);
  for (const criterion of criteria) component.push({ code: coded(system("observation-code"), "1"),
    valueCodeableConcept: coded(system("triage-criterion"), criterion) });
  if (calculated.status === "provisional") notes.push("Provisional calculated WEST priority.");
  if (manual) {
    notes.push(`Manual WEST priority. Calculated: ${calculated.colour ?? "unassessed"}. Selected by ${manual.enteredBy} at ${manual.enteredAt}; calculated at selection: ${manual.calculatedColourWhenSelected ?? "unassessed"}.`);
    if (manual.inheritedFromMeasurement) notes.push(`Inherited from measurement ${manual.inheritedFromMeasurement}.`);
  }
  observation("triage-observation", "survey", coded(snomed, "425705009"), {
    identifier: [{ system: "https://opentriage.org/identifiers/vital-measurement", value: source.measurementId }],
    valueCodeableConcept: coded(system("triage-priority"), map.priority[effective]), ...(component.length ? { component } : {}),
    ...(basis.length ? { derivedFrom: basis } : {}), ...(notes.length ? { note: notes.map(text => ({ text })) } : {}),
  }, [`WEST-A: ${effective}. Primary complaint: ${source.primaryCategory ?? "undocumented"}.`, ...findingText, ...notes].join(" "));
  return { resourceType: "Bundle", type: "collection", ...(security ? { meta: { security } } : {}),
    entry: resources.map(resource => ({ fullUrl: ref(resource).reference, resource })) };
}

/** Read one finalized ePCR measurement, including values in its nested NEMSIS groups. */
export async function buildWestFhirFromEncounter({ document, configuration, measurementId, context }, patient, options) {
  const { vitalMeasurementValues } = await import("../apps/web/app/canonical-events.ts");
  const { vitalDecisionSupport } = await import("../apps/web/app/vital-decision-support.ts");
  const pinned = configuration.definition;
  const group = document.groups.find(group => group.id === pinned.assessment.group);
  const instance = group?.instances.find(row => row.instanceId === measurementId);
  assert.ok(instance?.decisionSupportCalculation, "Select a finalized WEST measurement");
  const saved = instance.decisionSupportCalculation;
  assert.equal(saved.systemKey, pinned.key);
  assert.equal(saved.version, pinned.version);
  const time = instance.elements.find(element => element.id === "eVitals.01")?.values[0];
  assert.equal(time?.kind, "scalar", "The saved assessment requires its measurement time");
  const assessment = vitalDecisionSupport(instance, configuration);
  const elementIds = Object.values(pinned.inputs).flatMap(input => input.element ? [input.element] : []);
  return buildWestFhirBundle({
    ...context, encounterId: document.encounter.id, definitionKey: saved.systemKey, definitionVersion: saved.version,
    measurementId, measurementInstant: time.value, utcOffsetMinutes: time.utcOffsetMinutes,
    measurements: vitalMeasurementValues(document, instance, elementIds),
    observations: assessment.observations, findings: assessment.findings, scale: assessment.scale,
    override: assessment.override, savedCalculation: assessment.calculation,
  }, patient, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceFile, patientFile] = process.argv.slice(2);
  assert.ok((!sourceFile && !patientFile) || (sourceFile && patientFile && process.argv.length === 4),
    "Pass both an assessment JSON and its patient JSON, or neither for the fictional example");
  const read = file => JSON.parse(readFileSync(file, "utf8"));
  const source = read(sourceFile ?? new URL("../packages/contracts/fhir/west-a/assessment.example.json", import.meta.url));
  const patient = read(patientFile ?? new URL("../packages/contracts/examples/hospital/arne-patient.json", import.meta.url));
  const bundle = source.document ? await buildWestFhirFromEncounter(source, patient) : buildWestFhirBundle(source, patient);
  console.log(JSON.stringify(bundle, null, 2));
}
