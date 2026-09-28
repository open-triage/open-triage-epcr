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
  assert.match(component, /noteUi.cycle.camera/);
  assert.doesNotMatch(component, /Live camera only|never offered for selection/);
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
  for (const label of ["noteUi.rotate.counterclockwise.90", "noteUi.rotate.clockwise.90", "noteUi.discard.retake", "noteUi.take.photo", "noteUi.delete.photo", "noteUi.save.caption"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /role={confirmingDelete \? "alertdialog" : "dialog"}/);
  assert.match(component, /aria-modal="true"/);
  assert.doesNotMatch(component, /download=/);
  assert.match(component, /noteUi.retry.upload/);
});

test("live camera controls put icon rotation around camera cycling and capture with close on a second row", async () => {
  const component = await readFile(path.join(webRoot, "components/photo-note.tsx"), "utf8");
  const styles = await readFile(path.join(webRoot, "app/styles.css"), "utf8");
  assert.match(component, /camera-control-row[\s\S]+noteUi.rotate.counterclockwise.90[\s\S]+noteUi.cycle.camera[\s\S]+noteUi.rotate.clockwise.90/);
  assert.match(component, /camera-capture-row[\s\S]+camera-capture-button[\s\S]+noteUi.take.photo[\s\S]+camera-close-button[\s\S]+noteUi.close/);
  assert.match(styles, /\.camera-control-row\s*{[^}]*grid-template-columns:\s*56px minmax\(120px, 1fr\) 56px/);
  assert.match(styles, /\.camera-capture-row \.camera-capture-button\s*{[^}]*min-height:\s*64px[^}]*background:\s*var\(--green\)/);
  assert.match(styles, /\.camera-capture-row \.camera-close-button\s*{[^}]*min-height:\s*64px[^}]*background:\s*#b42318/);
});

test("live and captured photos rotate inside square frames without overlapping controls", async () => {
  const component = await readFile(path.join(webRoot, "components/photo-note.tsx"), "utf8");
  const styles = await readFile(path.join(webRoot, "app/styles.css"), "utf8");
  assert.match(component, /camera-live-frame/);
  assert.match(styles, /\.camera-live-frame, \.photo-preview-frame\s*{[^}]*aspect-ratio:\s*1[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.camera-stage video, \.photo-preview-frame img\s*{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*contain/);
});

test("one shared photo lifecycle includes every offline and transfer state", async () => {
  const contracts = await readFile(path.resolve(webRoot, "../../packages/contracts/src/index.ts"), "utf8");
  assert.match(contracts, /"saved-on-device" \| "uploading" \| "processing" \| "ready" \| "failed"/);
});

test("workspace permits offline capture and warns before closing with pending media", async () => {
  const source = await readFile(path.join(webRoot, "app/page.tsx"), "utf8");
  assert.match(source, /aria-label={t\("mobile.addPhoto"\)}[^\n]+disabled={!report \|\| editingBlocked}/);
  assert.match(source, /hasPendingProtectedMedia/);
  assert.match(source, /mobile.mediaCloseWarning/);
});
