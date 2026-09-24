import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportPhotoNote, ReportTextNote } from "@open-triage/contracts";
import { EncounterTimeline, filterEncounterTimeline, type EncounterTimelineItem } from "../components/encounter-timeline";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import { loadStationaryTimelineOpen, stationaryTimelinePreferenceKey, storeStationaryTimelineOpen } from "../app/stationary-timeline-preference";

const note: ReportTextNote = { id: "note-1", reportId: "report-1", type: "text", content: "Patient feels better.", capturedAt: "2026-09-24T12:02:00.000Z", capturedUtcOffsetMinutes: 0, author: { id: "user-1", displayName: "Alex Clinician" }, serverReceivedAt: "2026-09-24T12:02:01.000Z", updatedAt: "2026-09-24T12:02:01.000Z", persistenceState: "ready" };
const photo: ReportPhotoNote = { id: "photo-1", reportId: "report-1", type: "photo", caption: "Medication labels", capturedAt: "2026-09-24T12:03:00.000Z", capturedUtcOffsetMinutes: 0, author: { id: "user-1", displayName: "Alex Clinician" }, serverReceivedAt: "2026-09-24T12:03:01.000Z", updatedAt: "2026-09-24T12:03:01.000Z", persistenceState: "ready", contentType: "image/jpeg", byteSize: 1234, sha256: "a".repeat(64), width: 800, height: 600 };
const events: EncounterTimelineItem[] = [
  { id: photo.id, kind: "photo-note", date: "2026-09-24", time: "12:03", sortTime: photo.capturedAt, note: photo },
  { id: note.id, kind: "text-note", date: "2026-09-24", time: "12:02", sortTime: note.capturedAt, note },
  { id: "dispatch-1", kind: "document", date: "2026-09-24", time: "12:01", sortTime: "2026-09-24T12:01:00.000Z", title: "Dispatch notified", detail: "", reference: "eTimes.03" },
];

test("the reusable encounter timeline renders shared rows and exposes accessible filters", () => {
  const html = renderToStaticMarkup(createElement(EncounterTimeline, { events, validationStatuses: new Map(), definition: standardEncounterDefinition, headingId: "timeline-heading", onOpenTextNote: () => undefined, onOpenPhoto: () => undefined, onOpenEvent: () => undefined }));
  assert.match(html, /<h1 id="timeline-heading">Timeline<\/h1>/);
  assert.match(html, /role="group" aria-labelledby=/);
  assert.match(html, /aria-pressed="true">All/);
  assert.match(html, /aria-pressed="false">Notes/);
  assert.match(html, /Patient feels better/);
  assert.match(html, /Medication labels/);
  assert.match(html, /Dispatch notified/i);
  assert.deepEqual(filterEncounterTimeline(events, "notes").map(({ id }) => id), ["photo-1", "note-1"]);
});

test("stationary timeline preference is closed by default and scoped to the clinician", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(loadStationaryTimelineOpen(storage, "clinician/a"), false);
  storeStationaryTimelineOpen(storage, "clinician/a", true);
  assert.equal(values.get(stationaryTimelinePreferenceKey("clinician/a")), "open");
  assert.equal(loadStationaryTimelineOpen(storage, "clinician/a"), true);
  assert.equal(loadStationaryTimelineOpen(storage, "clinician/b"), false);
});
