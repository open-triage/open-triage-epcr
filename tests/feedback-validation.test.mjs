import assert from "node:assert/strict";
import test from "node:test";
import {
  ValidationAppError, launchPlan, managedProcessMatches, parseValidationArguments,
} from "../scripts/feedback-validation.mjs";

test("validation command accepts only lifecycle operations", () => {
  for (const command of ["start", "status", "stop"]) {
    assert.equal(parseValidationArguments([command]), command);
  }
  assert.throws(() => parseValidationArguments([]), ValidationAppError);
  assert.throws(() => parseValidationArguments(["start", "--port", "4000"]), ValidationAppError);
});

test("validation launch planning reuses matching services and rejects unknown listeners", () => {
  assert.deepEqual(launchPlan({
    api: { portOpen: true, matching: true },
    web: { portOpen: false, matching: false },
  }), { startApi: false, startWeb: true });
  assert.throws(() => launchPlan({
    api: { portOpen: true, matching: false },
    web: { portOpen: false, matching: false },
  }), /api port is occupied/);
  assert.throws(() => launchPlan({
    api: { portOpen: false, matching: false },
    web: { portOpen: true, matching: false },
  }), /web port is occupied/);
});

test("managed process checks require the recorded environment marker and repository cwd", () => {
  const dependencies = {
    signal: () => undefined,
    readlink: () => "/repo",
    read: () => "PATH=/bin\0OPEN_TRIAGE_FEEDBACK_VALIDATION_ID=validation:web\0",
    root: "/repo",
  };
  assert.equal(managedProcessMatches(42, "validation:web", dependencies), true);
  assert.equal(managedProcessMatches(42, "validation:api", dependencies), false);
  assert.equal(managedProcessMatches(42, "validation:web", { ...dependencies, readlink: () => "/other" }), false);
  assert.equal(managedProcessMatches(0, "validation:web", dependencies), false);
  assert.equal(managedProcessMatches(42, "validation:web", { ...dependencies, signal: () => { throw new Error("gone"); } }), false);
});
