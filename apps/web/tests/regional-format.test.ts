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
