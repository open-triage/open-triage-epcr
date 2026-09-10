import assert from "node:assert/strict";
import test from "node:test";
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json" with { type: "json" };
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { InstallationController } from "../dist/config/installation.controller.js";

test("publishes one authoritative synthetic profile with active fixture evidence", async () => {
  const original = process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
  process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = "synthetic-demo";
  try {
    const controller = new InstallationController({ query: async () => [{
      id: SYNTHETIC_DEMO_FIXTURE.formVersionId,
      version: 6,
      definition_sha256: "fixture-digest",
      section_count: String(SYNTHETIC_DEMO_FIXTURE.expectedSectionCount),
      field_count: String(SYNTHETIC_DEMO_FIXTURE.expectedFieldCount),
    }] });
    const result = await controller.get();
    assert.equal(result.profile, "synthetic-demo");
    assert.deepEqual(result.settings, syntheticDemo);
    assert.equal(result.demoLogin?.username, SYNTHETIC_DEMO_FIXTURE.administratorUsername);
    assert.equal(result.fixture?.activeFormVersionId, SYNTHETIC_DEMO_FIXTURE.formVersionId);
    assert.equal(result.fixture?.activeFormDefinitionSha256, "fixture-digest");
    assert.equal(result.fixture?.fieldCount, SYNTHETIC_DEMO_FIXTURE.expectedFieldCount);
  } finally {
    if (original === undefined) delete process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
    else process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = original;
  }
});
