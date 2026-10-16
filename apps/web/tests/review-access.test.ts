import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianSession } from "@open-triage/contracts";
import { reviewAccess } from "../app/review-access";

const session = (overrides: Partial<ClinicianSession> = {}): ClinicianSession => ({
  user: { id: "user", displayName: "Clinician" }, organization: { id: "agency", name: "Agency" },
  startedAt: "2026-10-16T12:00:00Z", expiresAt: "2026-10-16T20:00:00Z",
  capabilities: ["review:self", "review:all", "review:admin"], ...overrides,
});

test("Review applies the installation patient-data ceiling to cached grants", () => {
  for (const authority of ["installationOwner", "installationSuperadmin"]) {
    assert.deepEqual(reviewAccess(session({ [authority]: true })), { all: false, administrator: false });
  }
});

test("ordinary accounts retain only their explicitly granted Review access", () => {
  assert.deepEqual(reviewAccess(session()), { all: true, administrator: true });
  assert.deepEqual(reviewAccess(session({ capabilities: ["review:all"] })), { all: true, administrator: false });
  for (const capabilities of [undefined, [], ["review:self"], ["review:admin"]]) {
    assert.deepEqual(reviewAccess(session({ capabilities })), { all: false, administrator: false });
  }
});
