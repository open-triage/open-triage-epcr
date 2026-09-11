import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { ClinicalDemoUnit } from "@open-triage/contracts";
import { canGenerateSyntheticCall, canUseClinicalDemoDraftActions, selectedClinicalDemoUnit, shouldShowClinicalDemoBanner } from "../app/clinical-demo";

const eligible = (overrides: Partial<Parameters<typeof shouldShowClinicalDemoBanner>[0]> = {}) => ({
  authenticated: true,
  capabilities: ["clinical:document", "clinical:demo"],
  presentationMode: "mobile" as const,
  online: true,
  requestMode: "server" as const,
  ...overrides,
});

test("the Clinical Demo banner is limited to authenticated online clinical workspaces", () => {
  assert.equal(shouldShowClinicalDemoBanner(eligible()), true);
  assert.equal(shouldShowClinicalDemoBanner(eligible({ presentationMode: "stationary" })), true);
  assert.equal(shouldShowClinicalDemoBanner(eligible({ authenticated: false })), false);
  assert.equal(shouldShowClinicalDemoBanner(eligible({ capabilities: ["clinical:document"] })), false);
  assert.equal(shouldShowClinicalDemoBanner(eligible({ presentationMode: "admin" })), false);
  assert.equal(shouldShowClinicalDemoBanner(eligible({ online: false })), false);
  assert.equal(shouldShowClinicalDemoBanner(eligible({ requestMode: "static" })), false);
});

test("one eligible unit is automatic while multiple units require an explicit choice", () => {
  const units: ClinicalDemoUnit[] = [
    { id: "unit-1", callSign: "Medic 1", name: "First" },
    { id: "unit-2", callSign: "Medic 2", name: "Second" },
  ];
  assert.equal(selectedClinicalDemoUnit(units.slice(0, 1)), "unit-1");
  assert.equal(selectedClinicalDemoUnit(units), "");
  assert.equal(selectedClinicalDemoUnit(units, "unit-2"), "unit-2");
  assert.equal(selectedClinicalDemoUnit(units, "retired-unit"), "");
});

test("Generate is available only when neither the shell nor server has an open report", () => {
  assert.equal(canGenerateSyntheticCall(false, { hasOpenReport: false }), true);
  assert.equal(canGenerateSyntheticCall(true, { hasOpenReport: false }), false);
  assert.equal(canGenerateSyntheticCall(false, { hasOpenReport: true }), false);
});

test("demo draft actions require a server-qualified open draft", () => {
  const report = { id: "report", revision: 0, formVersionId: "form", status: "draft" as const,
    demoMutable: true };
  assert.equal(canUseClinicalDemoDraftActions(report), true);
  assert.equal(canUseClinicalDemoDraftActions({ ...report, demoMutable: false }), false,
    "ordinary or unprovenanced drafts cannot opt in");
  assert.equal(canUseClinicalDemoDraftActions({ ...report, status: "signed" } as never), false);
  assert.equal(canUseClinicalDemoDraftActions(null), false);
});

test("record cards do not gain synthetic or demo badges", async () => {
  const sources = await Promise.all([
    readFile(new URL("../components/assigned-calls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/open-calls.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of sources) assert.doesNotMatch(source, /demoMutable|synthetic badge|demo badge/i);
});

test("Delete is confirmation-gated before its server request", async () => {
  const source = await readFile(new URL("../components/clinical-demo-banner.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.confirm\([^]*deleteDraftReport\(/);
});
