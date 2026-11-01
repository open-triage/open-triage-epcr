import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adjustClinicalDate, adjustClockPart, formatClinicalTime, repeatDelay } from "../app/time-picker";
import { TimePicker } from "../components/time-picker";

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

test("an initial dial position does not render as an entered timestamp", () => {
  const html = renderToStaticMarkup(createElement(TimePicker, {
    label: "Assessment Date/Time",
    value: "",
    initialDate: "2026-09-04",
    initialValue: "10:30",
    onChange() {},
  }));
  assert.match(html, />Not recorded</);
  assert.doesNotMatch(html, /Choose date &amp; time/);
  assert.doesNotMatch(html, /Sep 4, 2026 · 10:30/);
});


test("Swedish time picker announces missing value without creating one", () => {
  const html = renderToStaticMarkup(createElement(TimePicker, { language: "sv", label: "Bedömningstid", value: "", initialDate: "2026-09-04", initialValue: "10:30", onChange() {} }));
  assert.match(html, /Ej registrerat/);
  assert.match(html, /Bedömningstid: ej registrerat/);
  assert.doesNotMatch(html, /10:30/);
});

test("local audit date ranges cover whole days across daylight-saving transitions", async () => {
  const { clinicalDateRange } = await import('../app/time-picker');
  const spring = clinicalDateRange('2026-03-29', '2026-03-29', 'Europe/Stockholm');
  assert.deepEqual(spring, { from: '2026-03-28T23:00:00.000Z', to: '2026-03-29T22:00:00.000Z' });
  assert.equal(Date.parse(spring.to) - Date.parse(spring.from), 23 * 3600000);
  assert.equal(Date.parse(spring.from), Date.parse('2026-03-28T23:00:00Z'));
  const autumn = clinicalDateRange('2026-10-25', '2026-10-25', 'Europe/Stockholm');
  assert.deepEqual(autumn, { from: '2026-10-24T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' });
  assert.equal(Date.parse(autumn.to) - Date.parse(autumn.from), 25 * 3600000);
});

test('audit date ranges use the API UTC format with agency and browser time zones', async () => {
  const { clinicalDateRange } = await import('../app/time-picker');
  for (const zone of [null, 'UTC', 'Europe/Stockholm', 'America/New_York', 'Asia/Kolkata']) {
    const range = clinicalDateRange('2026-10-23', '2026-10-29', zone);
    for (const value of Object.values(range)) {
      assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  }
});
