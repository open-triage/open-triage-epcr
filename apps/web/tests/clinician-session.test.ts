import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianSession } from "@open-triage/contracts";
import {
  CLINICIAN_SESSION_STORAGE_KEY,
  clearClinicianSession,
  defaultDemoUsername,
  loadClinicianSession,
  sessionIsActive,
  storeClinicianSession
} from "../app/clinician-session";

test("server-backed demos prefill the administrator while static demos retain the clinician", () => {
  const previous = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  assert.equal(defaultDemoUsername(), "demo.admin");
  process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
  assert.equal(defaultDemoUsername(), "demo.clinician");
  if (previous === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = previous;
});

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
