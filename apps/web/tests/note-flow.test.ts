import assert from "node:assert/strict";
import test from "node:test";
import type { ReportTextNote } from "@open-triage/contracts";
import { encounterEvents, saveCanonicalEvent } from "../app/canonical-events";
import { configuredQuickActions, type EncounterDefinition } from "../app/encounter-definition";
import { completeReportTimeline, noteReadinessBlockers, REPORT_TEXT_NOTE_MAX_CHARACTERS, reportTextNoteExcerpt, validateReportTextNote } from "../app/report-text-notes";
import { INITIAL_SHELL_STATE, type EncounterEvent } from "../app/standard-encounter";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";

function note(overrides: Partial<ReportTextNote> = {}): ReportTextNote {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    reportId: "20000000-0000-4000-8000-000000000001",
    type: "text",
    content: "Observed improvement after repositioning.",
    capturedAt: "2026-09-24T12:00:00.000Z",
    capturedUtcOffsetMinutes: 120,
    author: { id: "30000000-0000-4000-8000-000000000001", displayName: "Alex Clinician" },
    serverReceivedAt: "2026-09-24T12:00:01.000Z",
    updatedAt: "2026-09-24T12:00:01.000Z",
    persistenceState: "ready",
    ...overrides,
  };
}

test("text-note normalization is required, NFC, bounded, and rejects unsafe controls", () => {
  assert.deepEqual(validateReportTextNote("  A\u030Ake observed  "), {
    content: "Åke observed", error: null, characterCount: 12,
  });
  assert.match(validateReportTextNote(" \t ").error!, /Enter a text note/);
  assert.match(validateReportTextNote("unsafe\u0000value").error!, /control characters/);
  assert.equal(validateReportTextNote("first line\nsecond line").error, null);
  assert.equal(validateReportTextNote("x".repeat(REPORT_TEXT_NOTE_MAX_CHARACTERS)).error, null);
  assert.match(validateReportTextNote("x".repeat(REPORT_TEXT_NOTE_MAX_CHARACTERS + 1)).error!, /10,000/);
});

test("note readiness blockers stay separate and link non-ready notes to recovery actions", () => {
  const blockers = noteReadinessBlockers([
    note(),
    note({ id: "10000000-0000-4000-8000-000000000002", persistenceState: "uploading" }),
    note({ id: "10000000-0000-4000-8000-000000000003", persistenceState: "failed" }),
  ]);
  assert.deepEqual(blockers.map(({ note: blocked, action }) => ({ id: blocked.id, action })), [
    { id: "10000000-0000-4000-8000-000000000002", action: "Open note actions →" },
    { id: "10000000-0000-4000-8000-000000000003", action: "Open to retry or delete →" },
  ]);
  assert.ok(blockers.every(({ message }) => /before signing/.test(message)));
});

test("app-native text notes never change or project from eNarrative.01", () => {
  const document = structuredClone(INITIAL_SHELL_STATE.encounter.document);
  const event: EncounterEvent = {
    id: "visitor-note", date: "2026-09-24", time: "14:00", kind: "note",
    title: "Text note", detail: "Separate observation", reference: "app:report-note",
  };
  assert.strictEqual(saveCanonicalEvent(document, event, standardEncounterDefinition), document);

  const withNarrative = {
    ...document,
    groups: [...document.groups, {
      id: "eNarrativeSection",
      instances: [{
        instanceId: "formal-narrative",
        attributes: { "x-open-triage-owner": "clinician", documentedTime: "2026-09-24T14:00:00Z" },
        elements: [{ id: "eNarrative.01", values: [{ kind: "scalar" as const, occurrenceId: "narrative-value", value: "Formal patient care narrative" }] }],
      }],
    }],
  };
  assert.equal(encounterEvents(withNarrative, standardEncounterDefinition).some(({ kind }) => kind === "note"), false);
});

test("the Text note quick action is fixed and independent of the NEMSIS form profile", () => {
  const configured = {
    ...standardEncounterDefinition,
    composition: { ...standardEncounterDefinition.composition, quickActionOrder: ["note", "procedure", "medication", "vitals"] },
    events: { ...standardEncounterDefinition.events, note: {
      ...standardEncounterDefinition.events.note,
      quickAction: { visible: false, label: "Narrative shortcut" },
    } },
  } as EncounterDefinition;
  const actions = configuredQuickActions(configured);
  assert.deepEqual(actions.at(-1), { id: "note", label: "Text note", title: "Text note" });
  assert.equal(actions.filter(({ id }) => id === "note").length, 1);
});

test("complete timeline combines structured events and notes newest-first with stable note identity", () => {
  const older = note({ id: "10000000-0000-4000-8000-000000000001", capturedAt: "2026-09-24T12:00:00.000Z" });
  const newer = note({ id: "10000000-0000-4000-8000-000000000002", capturedAt: "2026-09-24T12:02:00.000Z", content: "Newest note" });
  const timeline = completeReportTimeline([
    { id: "structured", kind: "care", date: "2026-09-24", time: "12:01", dateTime: "2026-09-24T12:01:00.000Z", title: "Vitals" },
  ], [older, newer]);
  assert.deepEqual(timeline.map(({ id }) => id), [newer.id, "structured", older.id]);
  const item = timeline[0]!;
  assert.equal(item.kind, "text-note");
  if ("note" in item) {
    assert.equal(item.note.author.displayName, "Alex Clinician");
    assert.equal(item.note.persistenceState, "ready");
    assert.equal(item.time, new Date(newer.capturedAt).toTimeString().slice(0, 5));
  }
});

test("timeline presents notes in the viewer's local timezone, independent of capture offset", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "Europe/Stockholm";
  try {
  const capturedLocally = note({ capturedAt: "2026-09-24T22:30:00.000Z", capturedUtcOffsetMinutes: -240 });
  const [item] = completeReportTimeline([], [capturedLocally]);
  assert.equal(item?.date, "2026-09-25");
  assert.equal(item?.time, "00:30");
  assert.equal(capturedLocally.capturedUtcOffsetMinutes, -240);
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("timeline excerpts are compact without changing stored content", () => {
  const content = `  ${"observation ".repeat(30)} `;
  const excerpt = reportTextNoteExcerpt(content, 40);
  assert.equal([...excerpt].length, 40);
  assert.match(excerpt, /…$/);
  assert.match(content, /^  /);
});
