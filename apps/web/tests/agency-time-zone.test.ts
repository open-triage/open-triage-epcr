import assert from "node:assert/strict";
import test from "node:test";
import { clinicalInstantParts, clinicalWallTimeCandidates, clinicalWallTimeInput, isNamedTimeZone } from "../app/agency-time-zone";
import { encounterEvents, saveCanonicalEvent } from "../app/canonical-events";
import { INITIAL_SHELL_STATE, bundledEncounterDefinition, EMPTY_VITALS, type EncounterEvent } from "../app/standard-encounter";
import { localStationaryDateTimeParts, stationaryLocalDateTimeInput } from "../app/stationary-date-time";

test("a named zone gives the same clinical clock on devices in different zones", () => {
  const prior = process.env.TZ;
  try {
    for (const device of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      process.env.TZ = device;
      assert.deepEqual(localStationaryDateTimeParts("2026-09-28T13:45:00Z", "Europe/Stockholm"),
        { date: "2026-09-28", time: "15:45", offset: "+02:00" });
      assert.equal(stationaryLocalDateTimeInput("2026-09-28", "15:45", "Europe/Stockholm"), "2026-09-28T13:45:00.000+00:00");
    }
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test("the selected calendar date determines the named zone offset", () => {
  assert.equal(stationaryLocalDateTimeInput("2026-12-15", "17:04", "Europe/Stockholm"), "2026-12-15T16:04:00.000+00:00");
  assert.equal(stationaryLocalDateTimeInput("2026-09-22", "18:04", "Europe/Stockholm"), "2026-09-22T16:04:00.000+00:00");
  assert.equal(clinicalInstantParts("2026-09-28T23:30:00Z", "Europe/Stockholm")?.date, "2026-09-29");
});

test("DST gaps reject, overlaps require explicit first or second occurrence", () => {
  assert.deepEqual(clinicalWallTimeCandidates("2026-03-29", "02:30", "Europe/Stockholm"), []);
  assert.throws(() => clinicalWallTimeInput("2026-03-29", "02:30", "Europe/Stockholm"), /does not exist/);
  const repeated = clinicalWallTimeCandidates("2026-10-25", "02:30", "Europe/Stockholm");
  assert.deepEqual(repeated, ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
  assert.throws(() => clinicalWallTimeInput("2026-10-25", "02:30", "Europe/Stockholm"), /occurs twice/);
  assert.equal(Date.parse(clinicalWallTimeInput("2026-10-25", "02:30", "Europe/Stockholm", repeated[1])), Date.parse(repeated[1]!));
});

test("canonical event review and unrelated edits preserve the original instant", () => {
  const event: EncounterEvent = { id: "agency-zone-vital", date: "2026-10-25", time: "02:30", dateTime: "2026-10-25T01:30:00.000Z",
    kind: "care", title: "Vitals", detail: "", reference: "eVitals.VitalGroup", vitals: EMPTY_VITALS };
  let document = saveCanonicalEvent(INITIAL_SHELL_STATE.encounter.document, event, bundledEncounterDefinition, "Europe/Stockholm");
  const projected = encounterEvents(document, bundledEncounterDefinition, "Europe/Stockholm").find(({ id }) => id === event.id)!;
  assert.equal(projected.dateTime, event.dateTime);
  document = saveCanonicalEvent(document, { ...projected, vitals: { ...EMPTY_VITALS, heartRate: "80" } }, bundledEncounterDefinition, "Europe/Stockholm");
  assert.equal(encounterEvents(document, bundledEncounterDefinition, "Europe/Stockholm").find(({ id }) => id === event.id)?.dateTime, event.dateTime);
});

test("named zone validation excludes offsets and invalid identifiers", () => {
  assert.equal(isNamedTimeZone("Europe/Stockholm"), true);
  assert.equal(isNamedTimeZone("UTC"), true);
  assert.equal(isNamedTimeZone("+02:00"), false);
  assert.equal(isNamedTimeZone("Not/A_Zone"), false);
});
