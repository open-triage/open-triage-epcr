import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPresentationMode,
  hasAdminMode,
  hasClinicalMode,
  hasReviewMode,
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
  assert.equal(defaultPresentationMode(["admin-dashboard:read"]), "admin");
  assert.equal(defaultPresentationMode(["admin-dashboard:read", "clinical:document"]), "mobile");
  assert.equal(loadPresentationMode({ getItem: () => "admin" }, ["clinical:document"]), "mobile");
  assert.equal(loadPresentationMode({ getItem: () => "admin" }, ["admin-dashboard:read"]), "admin");
  assert.equal(loadPresentationMode({ getItem: () => "stationary" }, ["clinical:document"]), "stationary");
  assert.equal(loadPresentationMode({ getItem: () => "stationary" }, ["admin-dashboard:read"]), "admin");
  assert.equal(hasReviewMode(["review:identifying"]), false);
  assert.equal(hasReviewMode(["review:self"]), true);
  assert.equal(hasAdminMode(["review:all", "review:admin"]), false);
  assert.equal(defaultPresentationMode(["review:all"]), "review");
  assert.equal(loadPresentationMode({ getItem: () => "admin" }, ["review:all"]), "review");
  assert.equal(loadPresentationMode({ getItem: () => "review" }, ["review:all"]), "review");
  assert.equal(loadPresentationMode({ getItem: () => "review" }, ["review:identifying"]), "mobile");
});
