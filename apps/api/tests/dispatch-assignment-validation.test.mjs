import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateDispatchAssignment } from "../dist/dispatch/dispatch-assignment.validation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = JSON.parse(await readFile(resolve(root, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8"));
const source = JSON.parse(await readFile(resolve(root, "packages/contracts/examples/dispatch/synthetic-assignment.json"), "utf8"));
const cancellation = JSON.parse(await readFile(resolve(root, "packages/contracts/examples/dispatch/synthetic-cancellation.json"), "utf8"));

function copy(value = source) {
  return structuredClone(value);
}

function element(message, id) {
  return message.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements)
    .find((candidate) => candidate.id === id);
}

function removeElement(message, id) {
  for (const instance of message.groups.flatMap((group) => group.instances)) {
    instance.elements = instance.elements.filter((candidate) => candidate.id !== id);
  }
}

test("valid EMSDataSet content, including hidden patient identity and telephone values, survives unchanged", () => {
  const result = validateDispatchAssignment(copy(), catalog);
  assert.equal(result.status, "applied");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.canonical, source);
  assert.deepEqual(element(result.canonical, "ePatient.18"), element(source, "ePatient.18"));
  assert.deepEqual(element(result.canonical, "ePatient.02"), element(source, "ePatient.02"));
});

test("unsupported versions, unknown groups, and unknown or custom elements reject atomically", () => {
  const version = copy();
  version.dataModel.version = "3.4.0";
  assert.equal(validateDispatchAssignment(version, catalog).status, "rejected");

  const unknownGroup = copy();
  unknownGroup.groups.push({ id: "vendor:DispatchGroup", instances: [{ instanceId: "vendor-group", elements: [] }] });
  const groupResult = validateDispatchAssignment(unknownGroup, catalog);
  assert.equal(groupResult.status, "rejected");
  assert.equal(groupResult.canonical, null);
  assert.ok(groupResult.findings.some(({ code, pointer, groupId }) => code === "dispatch.catalog.unknown-group" && pointer.endsWith("/id") && groupId === "vendor:DispatchGroup"));

  const unknownElement = copy();
  unknownElement.groups.find(({ id }) => id === "ePatientSection").instances[0].elements.push({ id: "vendor.PatientNote", values: [{ kind: "scalar", occurrenceId: "custom-note", value: "unsafe" }] });
  const elementResult = validateDispatchAssignment(unknownElement, catalog);
  assert.equal(elementResult.status, "rejected");
  assert.ok(elementResult.findings.some(({ code, elementId }) => code === "dispatch.catalog.unknown-element" && elementId === "vendor.PatientNote"));
});

test("missing or invalid required response, routing, timing, and cancellation content rejects the complete snapshot", () => {
  for (const id of ["eResponse.03", "eResponse.04", "eResponse.13", "eResponse.14", "eTimes.02", "eTimes.03"]) {
    const message = copy();
    removeElement(message, id);
    const result = validateDispatchAssignment(message, catalog);
    assert.equal(result.status, "rejected", id);
    assert.equal(result.canonical, null, id);
    assert.ok(result.findings.some((finding) => finding.code === "dispatch.required" && finding.elementId === id), id);
  }

  const invalidRouting = copy();
  element(invalidRouting, "eResponse.14").values[0].value = 42;
  const routingResult = validateDispatchAssignment(invalidRouting, catalog);
  assert.equal(routingResult.status, "rejected");
  assert.ok(routingResult.findings.some(({ elementId, pointer }) => elementId === "eResponse.14" && /\/values\/0$/.test(pointer)));

  const nullResponse = copy();
  element(nullResponse, "eResponse.03").values[0] = { kind: "null", occurrenceId: "null-incident", notValue: { code: "7701003", display: "Not Recorded" } };
  assert.equal(validateDispatchAssignment(nullResponse, catalog).status, "rejected");

  const missingCancellationTime = copy(cancellation);
  removeElement(missingCancellationTime, "eTimes.14");
  assert.equal(validateDispatchAssignment(missingCancellationTime, catalog).status, "rejected");
});

test("invalid optional datatypes and codes are omitted with actionable NEMSIS findings", () => {
  const message = copy();
  element(message, "ePatient.17").values[0].value = "1980-02-31";
  element(message, "eDispatch.01").values[0].code = "not-a-code";
  const result = validateDispatchAssignment(message, catalog);

  assert.equal(result.status, "applied_with_findings");
  assert.equal(element(result.canonical, "ePatient.17"), undefined);
  assert.equal(element(result.canonical, "eDispatch.01"), undefined);
  assert.ok(result.findings.some(({ pointer, elementId, groupId }) => pointer.startsWith("/groups/") && elementId === "ePatient.17" && groupId === "ePatientSection"));
  assert.ok(result.findings.some(({ code, elementId }) => code === "dispatch.catalog.value" && elementId === "eDispatch.01"));
});

test("optional hierarchy and cardinality errors omit only the unsafe content", () => {
  const hierarchy = copy();
  hierarchy.groups.find(({ id }) => id === "ePatient.PatientNameGroup").instances[0].parentInstanceId = "synthetic-pcr-1";
  const hierarchyResult = validateDispatchAssignment(hierarchy, catalog);
  assert.equal(hierarchyResult.status, "applied_with_findings");
  assert.equal(hierarchyResult.canonical.groups.some(({ id }) => id === "ePatient.PatientNameGroup"), false);
  assert.ok(hierarchyResult.findings.some(({ code, groupId }) => code === "dispatch.catalog.group-placement" && groupId === "ePatient.PatientNameGroup"));

  const brokenRequiredAncestry = copy();
  brokenRequiredAncestry.groups.find(({ id }) => id === "EMSDataSet").instances[0].parentInstanceId = "not-allowed";
  assert.equal(validateDispatchAssignment(brokenRequiredAncestry, catalog).status, "rejected");

  const cardinality = copy();
  element(cardinality, "ePatient.17").values.push({ kind: "scalar", occurrenceId: "second-date-of-birth", value: "1981-01-01" });
  const cardinalityResult = validateDispatchAssignment(cardinality, catalog);
  assert.equal(cardinalityResult.status, "applied_with_findings");
  assert.equal(element(cardinalityResult.canonical, "ePatient.17"), undefined);
});

test("attribute and identity dependency failures omit invalid optional occurrences without damaging siblings", () => {
  const message = copy();
  const phones = element(message, "ePatient.18").values;
  phones[0].attributes.PhoneNumberType = "invalid";
  phones[1].occurrenceId = element(message, "ePatient.17").values[0].occurrenceId;
  const result = validateDispatchAssignment(message, catalog);

  assert.equal(result.status, "applied_with_findings");
  assert.equal(element(result.canonical, "ePatient.18"), undefined);
  assert.ok(result.findings.some(({ message, elementId }) => /PhoneNumberType/.test(message) && elementId === "ePatient.18"));
  assert.ok(result.findings.some(({ code, elementId }) => code === "dispatch.identity.duplicate-occurrence" && elementId === "ePatient.18"));
});
