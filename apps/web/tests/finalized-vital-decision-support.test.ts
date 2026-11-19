import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicalDecisionSupportConfiguration, DecisionSupportCatalogElement, DecisionSupportFieldName, EncounterGroupInstance, FinalizedDecisionSupportCalculation, TriageColour } from "@open-triage/contracts";
import westDefinition from "../../../defines/decision_support/west-a-2025.json";
import { encounterEvents, removeCanonicalEvent } from "../app/canonical-events";
import { latestFinalizedVitalDecisionSupport } from "../app/finalized-vital-decision-support";
import { bundledEncounterDefinition, INITIAL_SHELL_STATE, transitionShell, vitalDraftDecisionSupport } from "../app/standard-encounter";

function westField(name: DecisionSupportFieldName, slug: string,
  datatype: DecisionSupportCatalogElement["datatype"] = "coded"): DecisionSupportCatalogElement {
  const common = { id: name, namespace: "west.opentriage.org", slug: `Fixture${slug}`,
    title: slug, definition: slug, correlatesTo: westDefinition.assessment.group,
    usage: "Optional", recurrence: "single", identifying: false, decisionSupportField: name,
  } as const;
  return datatype === "coded" ? { ...common, datatype, choices: [],
    codeSystem: `https://opentriage.org/codes/west-a-2025/${name}`, permittedNotValues: [], permittedPertinentNegatives: [],
  } : { ...common, datatype, constraints: {} };
}

const configuration: ClinicalDecisionSupportConfiguration = {
  definition: westDefinition as ClinicalDecisionSupportConfiguration["definition"],
  fields: {
    overrideColour: westField("overrideColour", "OverrideColour"),
    categories: { ...westField("categories", "Categories"), recurrence: "multiple" },
    criteria: { ...westField("criteria", "Criteria"), recurrence: "multiple" },
    noWarningCriteria: westField("noWarningCriteria", "NoWarningCriteria", "boolean"),
    newsScale: westField("newsScale", "NewsScale"),
    physiologyScore: { ...westField("physiologyScore", "PhysiologyScore", "number"), readOnly: true, integer: true },
  },
};

function vital(instanceId: string, measurementInstant: string, calculation?: Omit<FinalizedDecisionSupportCalculation, "systemKey" | "version">,
  manual?: TriageColour): EncounterGroupInstance {
  return {
    instanceId,
    attributes: { "x-open-triage-owner": "clinician", documentedTime: measurementInstant },
    elements: [
      { id: "eVitals.01", values: [{ kind: "scalar", occurrenceId: `${instanceId}-time`, value: measurementInstant }] },
      ...(manual ? [{ id: "west.opentriage.org.FixtureOverrideColour", values: [{
        kind: "coded" as const, occurrenceId: `${instanceId}-override`, code: manual,
        attributes: { enteredBy: "author", enteredAt: "2025-03-02T20:00:00Z", calculatedColourWhenSelected: calculation?.colour ?? null },
      }] }] : []),
    ],
    ...(calculation ? { decisionSupportCalculation: {
      ...calculation, systemKey: configuration.definition.key, version: configuration.definition.version,
    } as FinalizedDecisionSupportCalculation } : {}),
  };
}

function report(instances: EncounterGroupInstance[]) {
  return { ...INITIAL_SHELL_STATE.encounter.document, groups: [
    ...INITIAL_SHELL_STATE.encounter.document.groups.filter(({ id }) => id !== "eVitals.VitalGroup"),
    { id: "eVitals.VitalGroup", instances },
  ] };
}

test("each timeline row reads its own stored WEST level, including manual downgrades and provisional levels", () => {
  const document = report([
    vital("a", "2025-03-02T08:00:00Z", { status: "definitive", colour: "red" }),
    vital("b", "2025-03-02T09:00:00Z", { status: "definitive", colour: "red" }, "green"),
    vital("c", "2025-03-02T10:00:00Z", { status: "provisional", colour: "orange" }),
    vital("legacy", "2025-03-02T11:00:00Z"),
  ]);
  const timeline = encounterEvents(document, bundledEncounterDefinition, "Europe/Stockholm", configuration);
  assert.deepEqual(timeline.filter(({ vitals }) => vitals).map(({ id, decisionSupport }) =>
    [id, decisionSupport?.colour, decisionSupport?.status, decisionSupport?.version]), [
      ["legacy", undefined, undefined, undefined],
      ["c", "orange", "provisional", westDefinition.version],
      ["b", "green", "manual", westDefinition.version],
      ["a", "red", "definitive", westDefinition.version],
    ]);
});

test("clients receiving measurements in opposite orders converge and supersede corrected or deleted entries", () => {
  const early = vital("a", "2025-03-02T08:00:00Z", { status: "definitive", colour: "red" });
  const tied = vital("b", "2025-03-02T09:00:00+01:00", { status: "definitive", colour: "red" }, "green");
  const unassessed = vital("c", "2025-03-02T10:00:00Z", { status: "unassessed", colour: null });
  const first = report([early, tied, unassessed]), second = report([tied, unassessed, early]);
  const current = latestFinalizedVitalDecisionSupport(first, configuration);
  assert.equal(current?.instanceId, tied.instanceId);
  assert.equal(current?.colour, "green");
  assert.deepEqual(latestFinalizedVitalDecisionSupport(second, configuration), current);

  const corrected = vital("b", "2025-03-02T07:59:59Z", { status: "definitive", colour: "red" }, "green");
  assert.equal(latestFinalizedVitalDecisionSupport(report([corrected, early, unassessed]), configuration)?.instanceId, early.instanceId);
  assert.equal(latestFinalizedVitalDecisionSupport(removeCanonicalEvent(first, tied.instanceId), configuration)?.instanceId, early.instanceId);
});

test("a pending vitals draft stays separate from the finalized WEST report and timeline", () => {
  const document = report([vital("a", "2025-03-02T08:00:00Z", { status: "definitive", colour: "red" })]);
  const draft = transitionShell({
    ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document },
  }, { type: "vitals-started", id: "pending", date: "2025-03-02", time: "09:00" });
  assert.ok(draft.vitalDraft);
  assert.equal(latestFinalizedVitalDecisionSupport(draft.encounter.document, configuration)?.colour, "red");
  assert.equal(encounterEvents(draft.encounter.document, bundledEncounterDefinition, "UTC", configuration)
    .filter(({ vitals }) => vitals).length, 1);
});

test("repeat Vitals inherit the preceding decisions by timestamp and stable ID, using fresh observations", () => {
  const earlier = vital("a", "2025-03-02T09:00:00+01:00", { status: "unassessed", colour: null }, "red");
  const first = { ...earlier, elements: [...earlier.elements,
    { id: "west.opentriage.org.FixtureNewsScale", values: [{ kind: "coded" as const, occurrenceId: "scale", code: "copd" }] },
  ] };
  const tied = vital("b", "2025-03-02T08:00:00Z", { status: "unassessed", colour: null }, "yellow");
  const newer = vital("z", "2025-03-02T12:00:00Z", { status: "unassessed", colour: null }, "orange");
  const second = { ...tied, elements: [...tied.elements,
    { id: "west.opentriage.org.FixtureCriteria", values: [{ kind: "coded" as const, occurrenceId: "absence", code: "infection.none" }] },
    { id: "west.opentriage.org.FixtureNoWarningCriteria", values: [{ kind: "scalar" as const, occurrenceId: "negative", value: true }] },
    { id: "eVitals.14", values: [{ kind: "scalar" as const, occurrenceId: "respiration", value: 30 }] },
  ] };
  const document = report([newer, second, first]);
  const start = transitionShell({
    ...INITIAL_SHELL_STATE, timeZone: "UTC", encounter: { ...INITIAL_SHELL_STATE.encounter, document },
  }, { type: "vitals-started", id: "c", date: "2025-03-02", time: "13:00", decisionSupport: configuration });
  assert.equal(vitalDraftDecisionSupport(start.vitalDraft, configuration).override?.colour, "orange");
  const backdated = transitionShell(start, { type: "vitals-time-changed", value: "08:00" });
  const review = vitalDraftDecisionSupport(backdated.vitalDraft, configuration);
  assert.equal(review.override?.inheritedFromMeasurement, "b");
  assert.equal(review.override?.colour, "yellow");
  assert.equal(review.override?.enteredBy, "author");
  assert.equal(review.scale, "copd");
  assert.deepEqual(review.findings, { criteria: ["infection.none"], noWarningCriteria: true });
  assert.equal(backdated.vitalDraft?.values.respiratoryRate, "");
  assert.deepEqual(review.calculation.physiology?.points, {});
  assert.equal(review.calculation.physiology?.total, null);

  const revised = transitionShell(backdated, { type: "document-opened", document: report([first]) });
  const serialized = JSON.parse(JSON.stringify(revised));
  const restored = transitionShell(start, { type: "state-restored", state: serialized });
  assert.deepEqual(vitalDraftDecisionSupport(restored.vitalDraft, configuration), review);
  const automatic = transitionShell(restored, { type: "vitals-override-changed", colour: null,
    decisionSupport: configuration, enteredBy: "author", enteredAt: "2025-03-02T13:00:00Z" });
  const laterClock = transitionShell(automatic, { type: "vitals-time-changed", value: "13:00" });
  assert.equal(vitalDraftDecisionSupport(laterClock.vitalDraft, configuration).override, null);
  assert.equal(transitionShell(laterClock, { type: "vitals-saved", decisionSupport: configuration }), laterClock);
});

test("an intervening legacy measurement supplies no decisions while the latest recorded NEWS scale carries forward", () => {
  const earlier = vital("a", "2025-03-02T08:00:00Z", { status: "unassessed", colour: null }, "red");
  const west = { ...earlier, elements: [...earlier.elements,
    { id: "west.opentriage.org.FixtureNewsScale", values: [{ kind: "coded" as const, occurrenceId: "scale", code: "copd" }] },
  ] };
  const document = report([west, vital("legacy", "2025-03-02T08:15:00Z")]);
  const started = transitionShell({
    ...INITIAL_SHELL_STATE, timeZone: "UTC", encounter: { ...INITIAL_SHELL_STATE.encounter, document },
  }, { type: "vitals-started", id: "repeat", date: "2025-03-02", time: "08:30", decisionSupport: configuration });
  const assessment = vitalDraftDecisionSupport(started.vitalDraft, configuration);
  assert.equal(assessment.scale, "copd");
  assert.equal(assessment.override, null);
  assert.equal(assessment.findings, undefined);
});
