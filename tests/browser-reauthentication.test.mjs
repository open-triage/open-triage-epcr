import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { beginBrowserReauthentication } from "../apps/api/tests/fixtures/browser-reauthentication.mjs";

for (const outcome of ["pending", "rejected"]) {
  test(`browser reauthentication waits for the provider instead of the outgoing ${outcome} promise`, async () => {
    let started = false;
    let providerReady = false;
    const page = {
      async evaluate(callback) {
        const result = runInNewContext(`(${callback.toString()})()`, {
          localStorage: { getItem: () => JSON.stringify({ csrfToken: "fixture-csrf" }) },
          fixture: {
            reauthenticateClinicianSession(password, csrfToken) {
              assert.equal(password, "");
              assert.equal(csrfToken, "fixture-csrf");
              started = true;
              return outcome === "pending" ? new Promise(() => {}) : Promise.reject(new Error("Document navigated"));
            },
          },
        });
        assert.equal(result, undefined, "page.evaluate must settle before navigation destroys its context");
      },
      getByRole(role, options) {
        assert.equal(started, true);
        assert.equal(role, "link");
        assert.equal(options.name, "Continue fictional provider login");
        return { async waitFor(options) { assert.equal(options.state, "visible"); providerReady = true; } };
      },
    };
    await beginBrowserReauthentication(page);
    assert.equal(providerReady, true);
  });
}
