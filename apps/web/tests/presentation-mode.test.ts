import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPresentationMode,
  hasAdminMode,
  hasClinicalMode,
  loadPresentationMode,
  PRESENTATION_MODE_STORAGE_KEY,
  storePresentationMode
} from "../app/presentation-mode";

test("presentation mode defaults safely to mobile and ignores invalid saved values", () => {
  assert.equal(loadPresentationMode({ getItem: () => null }), "mobile");
  assert.equal(loadPresentationMode({ getItem: () => "desktop" }), "mobile");
});

test("presentation mode persists independently in browser storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  storePresentationMode(storage, "stationary");

  assert.equal(values.get(PRESENTATION_MODE_STORAGE_KEY), "stationary");
  assert.equal(loadPresentationMode(storage), "stationary");
});

test("capabilities control available modes and safe session defaults", () => {
  assert.equal(hasClinicalMode(["clinical:document"]), true);
  assert.equal(hasAdminMode(["clinical:document"]), false);
  assert.equal(defaultPresentationMode(["installation:administer"]), "admin");
  assert.equal(defaultPresentationMode(["installation:administer", "clinical:document"]), "mobile");
  assert.equal(loadPresentationMode({ getItem: () => "admin" }, ["clinical:document"]), "mobile");
  assert.equal(loadPresentationMode({ getItem: () => "admin" }, ["installation:administer"]), "admin");
});
