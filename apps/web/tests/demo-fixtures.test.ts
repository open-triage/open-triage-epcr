import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { EncounterDocument } from "@open-triage/contracts";
import { projectDispatchAssignment } from "../../api/src/dispatch/dispatch-assignment.projection";
import { validateDispatchAssignment, type DispatchValidationCatalog } from "../../api/src/dispatch/dispatch-assignment.validation";
import generatedAssignedCalls from "../public/demo-assigned-calls.json";
import generatedOpenAssignment from "../public/demo-open-assignment.json";
import generatedOpenCalls from "../public/demo-open-calls.json";
import { incidentSummary } from "../app/incident-document";
import { buildDemoFixtures } from "../scripts/demo-fixture-core";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(webRoot, "../..");
const samplePath = resolve(repositoryRoot, "packages/contracts/examples/dispatch/synthetic-assignment.json");
const catalogPath = resolve(webRoot, "app/data/nemsis-data-model-3.5.1.json");

async function source(): Promise<{ bytes: Buffer; sample: Record<string, unknown>; catalog: DispatchValidationCatalog }> {
  const bytes = await readFile(samplePath);
  return {
    bytes,
    sample: JSON.parse(bytes.toString("utf8")) as Record<string, unknown>,
    catalog: JSON.parse(await readFile(catalogPath, "utf8")) as DispatchValidationCatalog,
  };
}

function element(message: Record<string, unknown>, elementId: string): { values: Array<Record<string, unknown>> } {
  const groups = message.groups as Array<{ instances: Array<{ elements: Array<{ id: string; values: Array<Record<string, unknown>> }> }> }>;
  const found = groups.flatMap(({ instances }) => instances).flatMap(({ elements }) => elements).find(({ id }) => id === elementId);
  assert.ok(found, `${elementId} must exist in the sample`);
  return found;
}

async function sourceFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? sourceFiles(child) : [child];
  }))).flat().filter((file) => [".ts", ".tsx"].includes(extname(file)));
}

test("generated static resources are the validator/projector output for the committed sample", async () => {
  const { bytes, sample, catalog } = await source();
  const validation = validateDispatchAssignment(sample, catalog);
  assert.ok(validation.canonical);
  const projection = projectDispatchAssignment(validation.canonical);
  const generated = buildDemoFixtures(sample, catalog, bytes);

  assert.deepEqual(generated.assignedCalls, generatedAssignedCalls);
  assert.deepEqual(generated.openAssignment, generatedOpenAssignment);
  assert.deepEqual(generated.openCalls, generatedOpenCalls);
  assert.equal(generatedAssignedCalls.generatedFrom.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(generatedAssignedCalls.assignedCalls[0], {
    ...generatedAssignedCalls.assignedCalls[0],
    callNumber: projection.incidentNumber,
    unit: { ...generatedAssignedCalls.assignedCalls[0]!.unit, callSign: projection.callSign },
    dispatchedAt: projection.unitNotifiedAt,
    dispatchReason: projection.dispatchReason,
  });
  assert.deepEqual(incidentSummary(generatedOpenAssignment.report.document as EncounterDocument), {
    incidentNumber: projection.incidentNumber,
    responseNumber: projection.responseNumber,
    callSign: projection.callSign,
    location: incidentSummary(generatedOpenAssignment.report.document as EncounterDocument).location,
  });
});

test("changing the JSON sample changes both rendered assignment and encounter context", async () => {
  const { bytes, sample, catalog } = await source();
  const changed = structuredClone(sample);
  const fingerprint = `FIXTURE-FINGERPRINT-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
  element(changed, "eResponse.03").values[0]!.value = fingerprint;

  const generated = buildDemoFixtures(changed, catalog, Buffer.from(JSON.stringify(changed)));
  assert.equal(generated.assignedCalls.assignedCalls[0]?.callNumber, fingerprint);
  assert.equal(incidentSummary(generated.encounterDocument).incidentNumber, fingerprint);
});

test("browser source does not duplicate fixture values from the dispatch sample", async () => {
  const { sample } = await source();
  const protectedElementIds = ["eResponse.03", "eResponse.04", "eResponse.13", "eResponse.14", "eTimes.02", "eTimes.03", "ePatient.01", "ePatient.17", "ePatient.18", "eScene.15", "eScene.16", "eScene.19"];
  const protectedValues = protectedElementIds.flatMap((id) => element(sample, id).values)
    .map((value) => String(value.value ?? value.code ?? "")).filter((value) => value.length >= 5);
  const files = await sourceFiles(webRoot);
  for (const file of files) {
    if (file.endsWith("demo-fixtures.test.ts")) continue;
    const text = await readFile(file, "utf8");
    for (const value of protectedValues) assert.equal(text.includes(value), false, `${file} duplicates dispatch fixture value ${value}`);
  }
});
