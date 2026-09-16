import assert from "node:assert/strict";
import test from "node:test";
import { feedbackDescriptionError, feedbackPrompt, FEEDBACK_DESCRIPTION_MAX_LENGTH, submitFeedback } from "../app/feedback";

test("feedback prompts require explicit type selection", () => {
  assert.match(feedbackPrompt(null), /Choose Bug or Feature/);
  assert.equal(feedbackPrompt("bug"), "What happened, and what did you expect to happen?");
  assert.equal(feedbackPrompt("feature"), "What would you like to do, and why would it help?");
});

test("feedback descriptions use the same required 4,000 character boundary as the API", () => {
  assert.match(feedbackDescriptionError("  ") ?? "", /Enter a description/);
  assert.equal(feedbackDescriptionError("x".repeat(FEEDBACK_DESCRIPTION_MAX_LENGTH)), null);
  assert.match(feedbackDescriptionError("x".repeat(FEEDBACK_DESCRIPTION_MAX_LENGTH + 1)) ?? "", /4,000/);
});

test("feedback rate-limit responses explain the rolling minute while preserving the draft", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  globalThis.fetch = async () => new Response(null, { status: 429 });
  try {
    await assert.rejects(submitFeedback("csrf-token", {
      idempotencyKey: "40000000-0000-4000-8000-000000000003",
      type: "feature",
      description: "Keep my draft",
      diagnostics: { status: "unavailable", schemaVersion: 1, reason: "capture-failed" },
    }), /sent feedback in the last minute.*description is still here/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});
