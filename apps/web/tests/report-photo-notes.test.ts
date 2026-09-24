import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  cameraRequestConstraints,
  canonicalPhotoDimensions,
  normalizePhotoCaption,
} from "../app/report-photo-notes";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("camera capture prefers the rear camera and cycles explicit video devices without library input", async () => {
  assert.deepEqual(cameraRequestConstraints(), { audio: false, video: { facingMode: { ideal: "environment" } } });
  assert.deepEqual(cameraRequestConstraints("rear-device"), { audio: false, video: { deviceId: { exact: "rear-device" } } });
  const component = await readFile(path.join(webRoot, "components/photo-note.tsx"), "utf8");
  assert.match(component, /enumerateDevices\(\)/);
  assert.match(component, /Cycle camera/);
  assert.match(component, /Live camera only/);
  assert.doesNotMatch(component, /type=["']file["']/);
  assert.doesNotMatch(component, /accept=["']image/);
});

test("canonical dimensions apply quarter-turn orientation and bound only the longest edge", () => {
  assert.deepEqual(canonicalPhotoDimensions(4000, 2000, 0), { width: 2560, height: 1280 });
  assert.deepEqual(canonicalPhotoDimensions(4000, 2000, 1), { width: 1280, height: 2560 });
  assert.deepEqual(canonicalPhotoDimensions(640, 480, -1), { width: 480, height: 640 });
});

test("optional captions normalize safely and enforce the accessible editor boundary", () => {
  assert.deepEqual(normalizePhotoCaption("  A\u030Ake’s bag  "), { caption: "Åke’s bag", characterCount: 9, error: null });
  assert.equal(normalizePhotoCaption(" ").caption, null);
  assert.match(normalizePhotoCaption("x".repeat(1001)).error ?? "", /1,000/);
  assert.match(normalizePhotoCaption("unsafe\u0000caption").error ?? "", /control/);
});

test("photo dialog exposes named rotation, discard, capture, delete, and caption controls without a download action", async () => {
  const component = await readFile(path.join(webRoot, "components/photo-note.tsx"), "utf8");
  for (const label of ["Rotate counterclockwise 90°", "Rotate clockwise 90°", "Discard &amp; retake", "Take photo", "Delete photo", "Save caption"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /role={confirmingDelete \? "alertdialog" : "dialog"}/);
  assert.match(component, /aria-modal="true"/);
  assert.doesNotMatch(component, /download=/);
  assert.match(component, /Retry upload/);
});

test("one shared photo lifecycle includes every offline and transfer state", async () => {
  const contracts = await readFile(path.resolve(webRoot, "../../packages/contracts/src/index.ts"), "utf8");
  assert.match(contracts, /"saved-on-device" \| "uploading" \| "processing" \| "ready" \| "failed"/);
});

test("workspace permits offline capture and warns before closing with pending media", async () => {
  const source = await readFile(path.join(webRoot, "app/page.tsx"), "utf8");
  assert.match(source, /aria-label="Add photo note"[^\n]+disabled={!report \|\| editingBlocked}/);
  assert.match(source, /hasPendingProtectedMedia/);
  assert.match(source, /Media uploads may pause after closing/);
});
