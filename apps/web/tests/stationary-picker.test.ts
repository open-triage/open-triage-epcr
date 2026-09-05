import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { stationaryCodedField } from "../app/stationary-coded-value";
import { scalarControlPresentation } from "../app/stationary-scalar";
import { StationaryCodedOccurrencesField } from "../components/stationary-coded-field";
import { StationaryScalarOccurrences } from "../components/stationary-scalar-occurrences";

const document = synthetic as EncounterDocument;
const patient = document.groups.find(({ id }) => id === "ePatientSection")!.instances[0]!;

test("repeatable phone values share one labeled multi-input picker", () => {
  const element = requireNemsisDataElement("ePatient.18");
  const html = renderToStaticMarkup(createElement(StationaryScalarOccurrences, {
    document,
    groupInstanceId: patient.instanceId,
    presentation: scalarControlPresentation(element),
    onDocumentChange() {},
  }));
  assert.equal((html.match(/<fieldset/g) ?? []).length, 1);
  assert.equal((html.match(/<legend/g) ?? []).length, 1);
  assert.equal((html.match(/type="tel"/g) ?? []).length, 3);
  assert.match(html, /Patient&#x27;s Phone Number/);
});

test("repeatable coded values share one canonical label dropdown picker", () => {
  const element = requireNemsisDataElement("ePatient.14");
  const values = patient.elements.find(({ id }) => id === element.id)?.values ?? [];
  const html = renderToStaticMarkup(createElement(StationaryCodedOccurrencesField, {
    field: stationaryCodedField(element),
    values,
    onChange() {},
  }));
  assert.equal((html.match(/<fieldset/g) ?? []).length, 1);
  assert.equal((html.match(/<legend/g) ?? []).length, 1);
  assert.equal((html.match(/<select/g) ?? []).length, values.length + 1);
  assert.doesNotMatch(html, /type="search"|>Display<|Code system/);
});

test("picker help is owned by the through-border legend", () => {
  const html = renderToStaticMarkup(createElement(StationaryCodedOccurrencesField, {
    field: stationaryCodedField("ePatient.24"),
    values: [],
    onChange() {},
  }));
  assert.match(html, /<legend class="stationary-picker-label">[\s\S]*stationary-element-tooltip[\s\S]*<\/legend>/);
});
