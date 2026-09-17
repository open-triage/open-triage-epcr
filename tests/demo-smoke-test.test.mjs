import assert from "node:assert/strict";
import test from "node:test";

import { verifyPublicDemo } from "../scripts/demo-smoke-test.mjs";
import productionSettings from "../packages/contracts/config/installation.production.json" with { type: "json" };

const sessionCookie = "open_triage_session=sensitive-session-token";
const sensitiveCallNumber = "PRIVATE-CALL-123";
const securityHeaders = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

function htmlResponse(value, status = 200, headers = {}) {
  return new Response(value, { status, headers: { ...securityHeaders, ...headers } });
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...securityHeaders, "content-type": "application/json", ...headers },
  });
}

test("verifies HTTPS routing, health, login, and an authenticated read", async () => {
  const requests = [];
  const output = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === "/") return htmlResponse("<title>OpenTriage synthetic encounter</title>");
    if (path === "/api/health") return jsonResponse({ status: "ok", service: "open-triage-api" });
    if (path === "/api/installation") return jsonResponse({ settings: productionSettings });
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

test("fails before login when either public surface loses a required security header", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const path = new URL(url).pathname;
    if (path === "/") return htmlResponse("<title>OpenTriage synthetic encounter</title>");
    return jsonResponse({ status: "ok", service: "open-triage-api" }, 200, {
      "strict-transport-security": "",
    });
  };

  await assert.rejects(
    verifyPublicDemo({
      frontendUrl: "https://demo.opentriage.org",
      apiUrl: "https://api.demo.opentriage.org",
      readinessAttempts: 1,
      readinessDelayMilliseconds: 0,
    }, { fetchImpl, log() {} }),
    /API health returned an invalid Strict-Transport-Security policy/,
  );
  assert.equal(calls, 2);
});

test("rejects a permissive CSP even when it prevents framing", async () => {
  let calls = 0;
  await assert.rejects(
    verifyPublicDemo({
      frontendUrl: "https://demo.opentriage.org",
      apiUrl: "https://api.demo.opentriage.org",
      readinessAttempts: 1,
      readinessDelayMilliseconds: 0,
    }, {
      fetchImpl: async () => {
        calls += 1;
        return htmlResponse("<title>OpenTriage synthetic encounter</title>", 200, {
          "content-security-policy": "default-src *; frame-ancestors 'none'",
        });
      },
      log() {},
    }),
    /invalid Content-Security-Policy/,
  );
  assert.equal(calls, 1);
});

test("supports an upgraded demo whose administered legacy fixture identity is preserved", async () => {
  const attemptedCredentials = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/") return htmlResponse("<title>OpenTriage synthetic encounter</title>");
    if (path === "/api/health") return jsonResponse({ status: "ok", service: "open-triage-api" });
    if (path === "/api/installation") return jsonResponse({ settings: productionSettings });
    if (path === "/api/sessions") {
      const candidate = JSON.parse(init.body);
      attemptedCredentials.push(candidate);
      if (candidate.username === "demo") return jsonResponse({}, 401);
      return jsonResponse({ csrfToken: "csrf-proof" }, 200, {
        "set-cookie": `${sessionCookie}; Path=/api; HttpOnly; Secure; SameSite=Strict`,
      });
    }
    if (path === "/api/calls/assigned") {
      return jsonResponse({ assignedCalls: [], canceledAssignmentIds: [] });
    }
    return new Response(null, { status: 404 });
  };

  await verifyPublicDemo({
    frontendUrl: "https://demo.opentriage.org",
    apiUrl: "https://api.demo.opentriage.org",
    readinessAttempts: 1,
    readinessDelayMilliseconds: 0,
  }, { fetchImpl, log() {} });

  assert.deepEqual(attemptedCredentials.map(({ username }) => username), ["demo", "demo.admin"]);
});

test("fails on an unsuccessful authenticated read without logging its body", async () => {
  const output = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/") return htmlResponse("<title>OpenTriage synthetic encounter</title>");
    if (path === "/api/health") return jsonResponse({ status: "ok", service: "open-triage-api" });
    if (path === "/api/installation") return jsonResponse({ settings: productionSettings });
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
