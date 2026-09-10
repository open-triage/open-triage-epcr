import assert from "node:assert/strict";
import test from "node:test";
import { CsrfGuard } from "../dist/sessions/csrf.guard.js";
import { SESSION_COOKIE } from "../dist/sessions/clinician-session.controller.js";

function context(request) {
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

test("CSRF checks apply only to cookie-authenticated state changes", async () => {
  const proofs = [];
  const guard = new CsrfGuard({ assertCsrf: async (...proof) => { proofs.push(proof); } });

  assert.equal(await guard.canActivate(context({ method: "GET", url: "/api/reports", headers: {} })), true);
  assert.equal(await guard.canActivate(context({ method: "POST", originalUrl: "/api/sessions?next=/", headers: {} })), true);
  assert.equal(await guard.canActivate(context({ method: "PATCH", url: "/api/reports/one", headers: {
    authorization: "Bearer legacy-token",
  } })), true);
  assert.deepEqual(proofs, []);

  assert.equal(await guard.canActivate(context({ method: "DELETE", url: "/api/sessions/current", headers: {
    cookie: `theme=dark; ${SESSION_COOKIE}=cookie-token; other=value`,
    "x-csrf-token": "csrf-proof",
  } })), true);
  assert.deepEqual(proofs, [["cookie-token", "csrf-proof"]]);
});

test("cookie requests do not accept array-valued CSRF headers", async () => {
  let received;
  const guard = new CsrfGuard({ assertCsrf: async (_token, csrf) => { received = csrf; } });
  await guard.canActivate(context({ method: "POST", url: "/api/reports", headers: {
    cookie: `${SESSION_COOKIE}=cookie-token`, "x-csrf-token": ["one", "two"],
  } }));
  assert.equal(received, undefined);
});
