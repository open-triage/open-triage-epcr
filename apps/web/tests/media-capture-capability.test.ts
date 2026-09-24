import assert from "node:assert/strict";
import test from "node:test";
import { mediaCaptureErrorMessage, mediaCapturePreflightMessage } from "../app/media-capture-capability";

test("insecure and unsupported capture explanations preserve the text-note path", () => {
  assert.equal(mediaCapturePreflightMessage("camera", { secureContext: false, hasGetUserMedia: true }),
    "Camera capture requires a secure HTTPS connection. Reopen this agency site over HTTPS. Text notes remain available.");
  assert.match(mediaCapturePreflightMessage("camera", { secureContext: true, hasGetUserMedia: false })!,
    /not supported.*iOS Safari or Android Chrome.*Text notes remain available/);
  assert.match(mediaCapturePreflightMessage("microphone", { secureContext: true, hasGetUserMedia: true, hasRecorder: false })!,
    /recording is not supported.*Text notes remain available/);
  assert.equal(mediaCapturePreflightMessage("microphone", { secureContext: true, hasGetUserMedia: true, hasRecorder: true }), null);
});

test("permission and device failures give an actionable recovery while preserving text notes", () => {
  assert.match(mediaCaptureErrorMessage("camera", new DOMException("denied", "NotAllowedError")),
    /Allow camera access.*browser settings.*Text notes remain available/);
  assert.match(mediaCaptureErrorMessage("microphone", new DOMException("missing", "NotFoundError")),
    /Connect or enable a microphone.*Text notes remain available/);
  assert.match(mediaCaptureErrorMessage("microphone", new DOMException("busy", "NotReadableError")),
    /Close other apps.*Text notes remain available/);
});
