import assert from "node:assert/strict";
import test from "node:test";
import { platformErrorMessage, platformRequestError } from "../app/platform-errors";

const secret = "Patient free text must never become a translated error template";

test("agency language and English fallback use stable identity and named parameters", () => {
  assert.equal(platformErrorMessage({ code: "auth.invalidCredentials", message: secret }, 401, "sv"),
    "Användarnamnet eller lösenordet är felaktigt.");
  assert.equal(platformErrorMessage({ code: "auth.invalidCredentials" }, 401, "en"),
    "The username or password is incorrect.");
  assert.equal(platformErrorMessage({ code: "admin.temporaryPasswordDuration", params: { hours: 24 } }, 400, "sv"),
    "Det tillfälliga lösenordet måste gälla i 24 timmar.");
  assert.equal(platformErrorMessage({ code: "testOnly", params: { name: "Anna" } }, 400, "sv"),
    "English fallback for Anna");
  assert.equal(platformErrorMessage({ code: "reports.revisionConflict", params: { expectedRevision: 3, currentRevision: 4 } }, 409, "sv"),
    "Journalen ändrades från version 3 till 4. Uppdatera och försök igen.");
});

test("legacy and unknown responses expose stable identifiable fallbacks without source prose", async () => {
  const legacy = await platformRequestError(new Response(JSON.stringify({ message: secret }), { status: 400 }), "sv");
  assert.equal(legacy.code, "legacy.http400");
  assert.equal(legacy.status, 400);
  assert.match(legacy.message, /legacy\.http400/);
  assert.ok(!legacy.message.includes(secret));
  const unknown = await platformRequestError(new Response(JSON.stringify({ code: "vendor.unrecognized", message: secret }), { status: 409 }), "en");
  assert.match(unknown.message, /vendor\.unrecognized/);
  assert.ok(!unknown.message.includes(secret));
});

test("generic domain identities retain retry, conflict, and permission meaning across languages", () => {
  assert.match(platformErrorMessage({ code: "calls.http409" }, 409, "sv"), /uppdatera och försök igen/);
  assert.match(platformErrorMessage({ code: "admin.http403" }, 403, "sv"), /saknar behörighet/);
  assert.match(platformErrorMessage({ code: "reports.http503" }, 503, "en"), /try again later/);
});
