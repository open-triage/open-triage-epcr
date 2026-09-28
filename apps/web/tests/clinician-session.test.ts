import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianSession } from "@open-triage/contracts";
import {
  CLINICIAN_SESSION_STORAGE_KEY,
  authenticateRestartedClinicianSession,
  clearClinicianSession,
  changeClinicianPassword,
  createClinicianSession,
  endClinicianSession,
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

test("browser restart trusts only a matching authenticated server identity", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const stored = { ...session, accessToken: undefined, csrfToken: "persisted-csrf", user: { ...session.user, displayName: "Stale label" } };
  try {
    globalThis.fetch = async () => Response.json({ ...session, accessToken: undefined, csrfToken: undefined,
      user: { ...session.user, displayName: "Server label" } });
    const authenticated = await authenticateRestartedClinicianSession(stored);
    assert.equal(authenticated?.user.displayName, "Server label");
    assert.equal(authenticated?.csrfToken, "persisted-csrf");

    globalThis.fetch = async () => Response.json({ ...session, user: { id: "other-user", displayName: "Other" } });
    assert.equal(await authenticateRestartedClinicianSession(stored), null);
    globalThis.fetch = async () => new Response(null, { status: 401 });
    assert.equal(await authenticateRestartedClinicianSession(stored), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});

test("cookie-backed sessions remain valid without an access token", () => {
  const storage = memoryStorage();
  const { accessToken: _accessToken, ...sessionWithoutToken } = session;
  const cookieSession: ClinicianSession = { ...sessionWithoutToken, csrfToken: "csrf-proof" };
  storeClinicianSession(storage, cookieSession);

  assert.deepEqual(loadClinicianSession(storage, new Date("2026-09-03T21:00:00.000Z")), cookieSession);
});

test("manual logout removes the browser session immediately", () => {
  const storage = memoryStorage();
  storeClinicianSession(storage, session);
  clearClinicianSession(storage);
  assert.equal(loadClinicianSession(storage), null);
});

test("invalid, incomplete, and malformed stored sessions are purged", () => {
  for (const encoded of ["not-json", JSON.stringify({ ...session, accessToken: "", user: null })]) {
    const storage = memoryStorage();
    storage.setItem(CLINICIAN_SESSION_STORAGE_KEY, encoded);
    assert.equal(loadClinicianSession(storage), null);
    assert.equal(storage.getItem(CLINICIAN_SESSION_STORAGE_KEY), null);
  }
});

test("server session adapters send credentials and map authentication failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json(session);
    };
    assert.deepEqual(await createClinicianSession({ username: "clinician", password: "password" }), session);
    assert.deepEqual(await changeClinicianPassword("old password", "new password value", "csrf-proof"), session);
    await endClinicianSession("csrf-proof");
    assert.deepEqual(requests.map(({ url, init }) => [url, init?.method]), [
      ["http://localhost:3001/api/sessions", "POST"],
      ["http://localhost:3001/api/sessions/password", "POST"],
      ["http://localhost:3001/api/sessions/current", "DELETE"],
    ]);
    assert.equal((requests[1]!.init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");

    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(createClinicianSession({ username: "bad", password: "bad" }), /legacy.http401/i);
    await assert.rejects(changeClinicianPassword("bad", "new password value", "csrf"), /legacy.http401/i);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(createClinicianSession({ username: "user", password: "password" }), /legacy.http503/i);
    await assert.rejects(changeClinicianPassword("old", "new password value", "csrf"), /legacy.http503/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});
