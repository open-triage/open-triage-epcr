import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, evaluateValidationBundle, NEMSIS_351_EMS_NORMALIZATIONS,
  type CompiledValidationBundle, type EncounterDocument } from "@open-triage/contracts";
import { syntheticEncounter } from "../app/standard-encounter";
import { stationaryDateTimeDefault } from "../app/stationary-scalar";
import { stationaryDateTimeSelection } from "../app/stationary-date-time";

test("accepting the second vital set's suggested time does not introduce either chronology warning", () => {
  const timestamp = "2026-10-29T14:55:57.000Z";
  const versionId = "51000000-0000-4000-8000-000000000099";
  const rules = (["nemSch_e126", "nemSch_e127"] as const).map((id) => compileValidationRule({
    id, name: id, enabled: true, severity: "warning", executionTargets: ["live", "sign"],
    primaryTargetElementId: "eVitals.01", message: id,
    source: NEMSIS_351_EMS_NORMALIZATIONS[id]!.source,
  }, versionId, new Set(["eTimes.03", "eTimes.07", "eVitals.01", "eVitals.02"])).compiled!);
  assert.ok(rules.every(Boolean));
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules };
  const document: EncounterDocument = { ...syntheticEncounter.document, groups: [
    { id: "eTimesSection", instances: [{ instanceId: "times", elements: [
      { id: "eTimes.03", values: [{ kind: "scalar", occurrenceId: "dispatch", value: "2026-10-29T14:55:56.665Z" }] },
      { id: "eTimes.07", values: [{ kind: "scalar", occurrenceId: "arrival", value: timestamp }] },
    ] }] },
    { id: "eVitals.VitalGroup", instances: [
      { instanceId: "first", elements: [{ id: "eVitals.01", values: [{ kind: "scalar", occurrenceId: "first-time", value: timestamp }] }] },
      { instanceId: "second", elements: [] },
    ] },
  ] };
  const suggested = stationaryDateTimeDefault(document, { groupId: "eVitals.VitalGroup", groupInstanceId: "second" });
  const second = document.groups[1]!.instances[1]!;
  const findings = (value: string) => evaluateValidationBundle(bundle, { ...document, groups: [document.groups[0]!, {
    ...document.groups[1]!, instances: [document.groups[1]!.instances[0]!, { ...second,
      elements: [{ id: "eVitals.01", values: [{ kind: "scalar", occurrenceId: "second-time", value }] }],
    }],
  }] }, "live", { timestamp: "2026-10-29T15:00:00Z" });
  assert.equal(findings("2026-10-29T14:55:00Z").length, 2, "minute truncation recreates both reported warnings");
  assert.deepEqual(findings(stationaryDateTimeSelection("2026-10-29", "15:55", "Europe/Stockholm", undefined, suggested)), []);
});
