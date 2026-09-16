import assert from "node:assert/strict";
import test from "node:test";
import { feedbackDescriptionError, feedbackPrompt, FEEDBACK_DESCRIPTION_MAX_LENGTH } from "../app/feedback";

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
