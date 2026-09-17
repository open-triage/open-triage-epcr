import assert from "node:assert/strict";
import test from "node:test";

import { API_SECURITY_HEADERS, securityHeaders } from "../dist/security-headers.js";

test("API responses receive the documented restrictive browser security policy", () => {
  const headers = new Map();
  let continued = false;
  securityHeaders({}, { setHeader: (name, value) => headers.set(name, value) }, () => { continued = true; });

  assert.equal(continued, true);
  assert.deepEqual(Object.fromEntries(headers), API_SECURITY_HEADERS);
  assert.match(headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.doesNotMatch(headers.get("Content-Security-Policy"), /unsafe-inline|unsafe-eval/);
  assert.equal(headers.get("X-Frame-Options"), "DENY");
});
