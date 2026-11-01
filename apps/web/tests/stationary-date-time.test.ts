import assert from "node:assert/strict";
import test from "node:test";
import { localStationaryDateTimeParts, stationaryLocalDateTimeInput, stationaryDateTimeSelection } from "../app/stationary-date-time";

test("accepting a suggested clinical time preserves seconds instead of moving it before dispatch", () => {
  const reference = "2026-10-29T14:55:57.000Z";
  const selected = stationaryDateTimeSelection("2026-10-29", "15:55", "Europe/Stockholm", undefined, reference);
  assert.equal(selected, reference);
  assert.ok(Date.parse(selected) >= Date.parse("2026-10-29T14:55:56.665Z"));
  assert.equal(stationaryDateTimeSelection("2026-10-29", "15:56", "Europe/Stockholm", undefined, reference),
    "2026-10-29T14:56:00.000+00:00");
  assert.equal(stationaryDateTimeSelection("2026-10-30", "15:55", "Europe/Stockholm", undefined, reference),
    "2026-10-30T14:55:00.000+00:00");
});

test("an explicit change to the other DST occurrence is saved even when the clock is unchanged", () => {
  const reference = "2026-10-25T00:30:57.123Z";
  assert.equal(stationaryDateTimeSelection("2026-10-25", "02:30", "Europe/Stockholm", "2026-10-25T00:30:00.000Z", reference), reference);
  assert.equal(stationaryDateTimeSelection("2026-10-25", "02:30", "Europe/Stockholm", "2026-10-25T01:30:00.000Z", reference),
    "2026-10-25T01:30:00.000+00:00");
});

test("stored UTC timestamps display in the browser's local clock and save the same instant", () => {
  const priorTimeZone = process.env.TZ;
  process.env.TZ = "Europe/Stockholm";
  try {
    const displayed = localStationaryDateTimeParts("2026-09-22T16:04:22.812Z");
    assert.deepEqual(displayed, { date: "2026-09-22", time: "18:04", offset: "+02:00" });
    const saved = stationaryLocalDateTimeInput(displayed!.date, displayed!.time);
    assert.equal(saved, "2026-09-22T16:04:00.000+00:00");
    assert.equal(Date.parse(saved), Date.parse("2026-09-22T16:04:00Z"));
  } finally {
    if (priorTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = priorTimeZone;
  }
});

test("editing a different date uses that date's daylight-saving offset", () => {
  const priorTimeZone = process.env.TZ;
  process.env.TZ = "Europe/Stockholm";
  try {
    assert.deepEqual(localStationaryDateTimeParts("2026-12-15T16:04:00Z"),
      { date: "2026-12-15", time: "17:04", offset: "+01:00" });
    assert.equal(stationaryLocalDateTimeInput("2026-12-15", "17:04"), "2026-12-15T16:04:00.000+00:00");
    assert.equal(stationaryLocalDateTimeInput("2026-09-22", "18:04"), "2026-09-22T16:04:00.000+00:00");
    assert.equal(stationaryLocalDateTimeInput("2026-03-29", "02:30"), "2026-03-29T01:30:00.000+00:00");
  } finally {
    if (priorTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = priorTimeZone;
  }
});
