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
