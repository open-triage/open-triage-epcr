import assert from "node:assert/strict";
import test from "node:test";
import { parseInstallationSettings } from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import { scalarEncounterValue } from "../app/stationary-scalar";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { canonicalDecimal, displayDecimal, formatClinicalDate, formatClinicalNumber } from "../app/regional-format";

test("English UI can use Swedish regional presentation without changing configured language", () => {
  const settings = parseInstallationSettings({ ...production, language: "en", regionalFormat: "sv-SE" });
  assert.equal(settings.language, "en");
  assert.equal(settings.regionalFormat, "sv-SE");
  assert.equal(formatClinicalDate("2026-09-28T13:45:00Z", settings.regionalFormat),
    new Intl.DateTimeFormat("sv-SE", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date("2026-09-28T13:45:00Z")));
  assert.equal(formatClinicalNumber(1234.5, settings.regionalFormat), new Intl.NumberFormat("sv-SE").format(1234.5));
  assert.equal(displayDecimal("12.5", settings.regionalFormat), "12,5");
  assert.equal(parseInstallationSettings(production).regionalFormat, undefined);
  assert.throws(() => parseInstallationSettings({ ...production, regionalFormat: "fr-FR" }), /regionalFormat/);
});

test("decimal entry accepts either separator and rejects ambiguous grouping", () => {
  for (const [entered, canonical] of [["12,5", "12.5"], ["12.5", "12.5"], [",5", ".5"], ["-0,75", "-0.75"]] as const) {
    assert.equal(canonicalDecimal(entered), canonical);
  }
  const canonical = canonicalDecimal("12,5");
  assert.equal(scalarEncounterValue(requireNemsisDataElement("eVitals.16"), canonical!, "occurrence").lexical, "12.5");
  for (const invalid of ["1,234.5", "1.234,5", "1,2,3", "NaN", "Infinity", "12 345", ""]) {
    assert.equal(canonicalDecimal(invalid), null);
  }
});

test("clinical controls show Swedish decimal and date text while retaining canonical values", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RegionalFormatContext } = await import("../app/regional-format");
  const { StationaryScalarControl } = await import("../components/stationary-scalar-control");
  const { TimePicker } = await import("../components/time-picker");
  const scalar = renderToStaticMarkup(createElement(RegionalFormatContext.Provider, { value: "sv-SE" },
    createElement(StationaryScalarControl, {
      presentation: { elementId: "eVitals.16", groupId: "eVitals", label: "ETCO₂", help: "Measurement",
        family: "numeric", inputType: "text", inputMode: "decimal", repeatable: false, maximumOccurrences: 1 },
      value: { kind: "scalar", occurrenceId: "occurrence", value: "12.5", lexical: "12.5" },
      onInput: () => undefined,
    })));
  assert.match(scalar, /inputMode="decimal"|inputmode="decimal"/i);
  assert.match(scalar, /value="12,5"/);
  const picker = renderToStaticMarkup(createElement(RegionalFormatContext.Provider, { value: "sv-SE" },
    createElement(TimePicker, { label: "Observed", date: "2026-09-28", value: "13:45", onChange: () => undefined })));
  assert.match(picker, /28 sep/);
  assert.match(picker, /aria-label="Observed: 28 sep/);
});

test("explicit date formatting options still honor the agency time zone", () => {
  assert.equal(formatClinicalDate("2026-10-29T23:30:00Z", "sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }, "Europe/Stockholm"), "2026-10-30 00:30");
});

test("shared timestamp display uses agency time, browser fallback and leaves date-only values intact", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AgencyTimeZoneContext } = await import("../app/agency-time-zone");
  const { LocalDateTime } = await import("../components/local-date-time");
  const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const render = (value: string, zone: string | null) => renderToStaticMarkup(createElement(AgencyTimeZoneContext.Provider,
    { value: zone }, createElement(LocalDateTime, { value, options, language: "en-US" })));
  assert.equal(render("2026-10-29T14:55:57Z", "Europe/Stockholm"), "15:55");
  assert.equal(render("2026-07-29T14:55:57Z", "Europe/Stockholm"), "16:55");
  assert.equal(render("2026-10-29T14:55:57Z", null), new Date("2026-10-29T14:55:57Z").toLocaleString("en-US", options));
  assert.equal(render("2026-10-29", "America/New_York"), "2026-10-29");
});

test("imported display text localizes complete instants while preserving calendar dates and prose", async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AgencyTimeZoneContext } = await import('../app/agency-time-zone');
  const { LocalDateTimeText } = await import('../components/local-date-time');
  const rendered = renderToStaticMarkup(createElement(AgencyTimeZoneContext.Provider, { value: 'Europe/Stockholm' },
    createElement(LocalDateTimeText, { language: 'sv', value: 'Observed 2026-10-29T14:55:57Z; born 2001-01-01.' })));
  assert.match(rendered, /15:55:57/);
  assert.match(rendered, /born 2001-01-01/);
  assert.doesNotMatch(rendered, /14:55:57Z/);
});
