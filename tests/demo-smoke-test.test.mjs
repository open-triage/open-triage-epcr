import assert from "node:assert/strict";
import test from "node:test";

import { verifyPublicDemo } from "../scripts/demo-smoke-test.mjs";
import fixture from "../packages/contracts/src/synthetic-demo-fixture.json" with { type: "json" };

const sessionCookie = "open_triage_session=sensitive-session-token";
const sensitiveCallNumber = "PRIVATE-CALL-123";

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("verifies HTTPS routing, health, login, and an authenticated read", async () => {
  const requests = [];
  const output = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === "/") return new Response("<title>OpenTriage synthetic encounter</title>");
    if (path === "/api/health") return jsonResponse({ status: "ok", service: "open-triage-api" });
    if (path === "/api/installation") return jsonResponse({
      profile: "synthetic-demo", settings: { syntheticFixtures: { enabled: true } },
      demoLogin: { username: fixture.administratorUsername, password: fixture.password },
      fixture: { id: fixture.id, revision: fixture.revision, activeFormVersionId: fixture.formVersionId,
        activeFormVersion: 2, activeFormDefinitionSha256: "a".repeat(64),
        sectionCount: fixture.expectedSectionCount, fieldCount: fixture.expectedFieldCount },
    });
    if (path === "/api/sessions") return jsonResponse({ csrfToken: "csrf-proof" }, 200, {
      "set-cookie": `${sessionCookie}; Path=/api; HttpOnly; Secure; SameSite=Strict`,
    });
    if (path === "/api/calls/assigned") {
      return jsonResponse({
        assignedCalls: [{ callNumber: sensitiveCallNumber }],
        canceledAssignmentIds: [],
      });
    }
    return new Response(null, { status: 404 });
  };

  await verifyPublicDemo({
    frontendUrl: "https://demo.opentriage.org",
    apiUrl: "https://api.demo.opentriage.org",
    readinessAttempts: 1,
    readinessDelayMilliseconds: 0,
  }, { fetchImpl, log: (message) => output.push(message) });

  assert.deepEqual(requests.map(({ url }) => url), [
    "https://demo.opentriage.org/",
    "https://api.demo.opentriage.org/api/health",
    "https://api.demo.opentriage.org/api/installation",
    "https://api.demo.opentriage.org/api/sessions",
    "https://api.demo.opentriage.org/api/calls/assigned",
  ]);
  assert.equal(requests[4].init.headers.cookie, sessionCookie);
  assert.equal(output.length, 5);
  assert.doesNotMatch(output.join("\n"), /sensitive-session-token|PRIVATE-CALL-123/);
});

test("requires HTTPS before sending credentials", async () => {
  let calls = 0;
  await assert.rejects(
    verifyPublicDemo({
      frontendUrl: "http://demo.opentriage.org",
      apiUrl: "https://api.demo.opentriage.org",
      readinessAttempts: 1,
    }, { fetchImpl: async () => { calls += 1; } }),
    /must use HTTPS/,
  );
  assert.equal(calls, 0);
});

test("fails on an unsuccessful authenticated read without logging its body", async () => {
  const output = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/") return new Response("<title>OpenTriage synthetic encounter</title>");
    if (path === "/api/health") return jsonResponse({ status: "ok", service: "open-triage-api" });
    if (path === "/api/installation") return jsonResponse({
      profile: "synthetic-demo", settings: { syntheticFixtures: { enabled: true } },
      demoLogin: { username: fixture.administratorUsername, password: fixture.password },
      fixture: { id: fixture.id, revision: fixture.revision, activeFormVersionId: fixture.formVersionId,
        activeFormVersion: 2, activeFormDefinitionSha256: "a".repeat(64),
        sectionCount: fixture.expectedSectionCount, fieldCount: fixture.expectedFieldCount },
    });
    if (path === "/api/sessions") return jsonResponse({ csrfToken: "csrf-proof" }, 200, {
      "set-cookie": `${sessionCookie}; Path=/api; HttpOnly; Secure; SameSite=Strict`,
    });
    return new Response(`sensitive response ${sensitiveCallNumber}`, { status: 503 });
  };

  await assert.rejects(
    verifyPublicDemo({
      frontendUrl: "https://demo.opentriage.org",
      apiUrl: "https://api.demo.opentriage.org",
      readinessAttempts: 1,
      readinessDelayMilliseconds: 0,
    }, { fetchImpl, log: (message) => output.push(message) }),
    /Authenticated read returned HTTP 503/,
  );
  assert.doesNotMatch(output.join("\n"), /sensitive-session-token|PRIVATE-CALL-123/);
});
