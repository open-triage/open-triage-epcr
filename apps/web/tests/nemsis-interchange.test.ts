import assert from "node:assert/strict";
import test from "node:test";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { deserializeEncounterDocument, loadEncounterDocument, serializeEncounterDocument } from "../app/encounter-document";
import { exportNemsisXml, importNemsisXml, NEMSIS_XSD, validateNemsisXml } from "../app/nemsis-interchange";

test("canonical JSON is deterministic, human-readable, valid, and lossless", () => {
  const document = loadEncounterDocument(synthetic);
  const first = serializeEncounterDocument(document);
  const reordered = { ...document, documentType: document.documentType, $schema: document.$schema };
  assert.equal(serializeEncounterDocument(reordered), first);
  assert.ok(first.endsWith("\n"));
  assert.deepEqual(deserializeEncounterDocument(first), document);
});

test("NEMSIS XML maps values, PN, repeats, custom results, and round trips losslessly", () => {
  const candidate = structuredClone(synthetic) as any;
  candidate.groups.push({ id: "org.example.ems:assessment", instances: [{ instanceId: "custom-1", attributes: { source: "device" }, elements: [{ id: "org.example.ems:score", values: [{ kind: "scalar", occurrenceId: "score-1", value: 7 }] }] }] });
  const document = loadEncounterDocument(candidate);
  const xml = exportNemsisXml(document);
  assert.match(xml, /<ePatient\.02>Rivera<\/ePatient\.02>/);
  assert.match(xml, /<eHistory\.08 PN="8801015">8801015<\/eHistory\.08>/);
  assert.match(xml, /<eCustomResults\.02>org\.example\.ems:score<\/eCustomResults\.02>/);
  assert.deepEqual(validateNemsisXml(xml), []);
  assert.deepEqual(importNemsisXml(xml), document);
  assert.match(xml, new RegExp(NEMSIS_XSD.replaceAll(".", "\\.")));
});

test("NEMSIS XML failures report canonical paths", () => {
  const diagnostics = validateNemsisXml('<EMSDataSet xmlns="wrong"><ePatient.99>x</ePatient.99></EMSDataSet>');
  assert.ok(diagnostics.some(({ path }) => path === "$"));
  assert.ok(diagnostics.some(({ path }) => path === "$.ePatient.99"));
});
