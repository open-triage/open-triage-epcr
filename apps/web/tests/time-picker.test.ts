import assert from "node:assert/strict";
import test from "node:test";
import { adjustClinicalDate, adjustClockPart, formatClinicalTime, repeatDelay } from "../app/time-picker";

test("clock values wrap at their limits", () => {
  assert.equal(adjustClockPart(23, 1, 24), 0);
  assert.equal(adjustClockPart(0, -1, 60), 59);
  assert.equal(formatClinicalTime(7, 4), "07:04");
});

test("dates advance across month and year boundaries", () => {
  assert.equal(adjustClinicalDate("2026-12-31", 1), "2027-01-01");
  assert.equal(adjustClinicalDate("2026-03-01", -1), "2026-02-28");
});

test("a sustained drag accelerates progressively", () => {
  assert.ok(repeatDelay(0) > repeatDelay(600));
  assert.ok(repeatDelay(600) > repeatDelay(1_300));
  assert.ok(repeatDelay(1_300) > repeatDelay(2_200));
});
