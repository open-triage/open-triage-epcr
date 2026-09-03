import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianSession } from "@open-triage/contracts";
import {
  CLINICIAN_SESSION_STORAGE_KEY,
  clearClinicianSession,
  loadClinicianSession,
  sessionIsActive,
  storeClinicianSession
} from "../app/clinician-session";

const session: ClinicianSession = {
  accessToken: "demo-token",
  user: { id: "user-id", displayName: "Synthetic Clinician" },
  organization: { id: "organization-id", name: "OpenTriage Synthetic EMS" },
  startedAt: "2026-09-03T08:00:00.000Z",
  expiresAt: "2026-09-03T22:00:00.000Z"
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}

test("stored clinician sessions remain active only before their fixed deadline", () => {
  const storage = memoryStorage();
  storeClinicianSession(storage, session);
  assert.equal(sessionIsActive(session, new Date("2026-09-03T21:59:59.999Z")), true);
  assert.deepEqual(loadClinicianSession(storage, new Date("2026-09-03T21:59:59.999Z")), session);
  assert.equal(loadClinicianSession(storage, new Date(session.expiresAt)), null);
  assert.equal(storage.getItem(CLINICIAN_SESSION_STORAGE_KEY), null);
});

test("manual logout removes the browser session immediately", () => {
  const storage = memoryStorage();
  storeClinicianSession(storage, session);
  clearClinicianSession(storage);
  assert.equal(loadClinicianSession(storage), null);
});
