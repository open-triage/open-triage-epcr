import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../../supabase/migrations/20260917120000_authentication_attempt_throttling.sql",
  import.meta.url), "utf8");
const throttle = await readFile(new URL("../../../apps/api/src/sessions/authentication-throttle.ts", import.meta.url), "utf8");
const sessions = await readFile(new URL("../../../apps/api/src/sessions/clinician-session.service.ts", import.meta.url), "utf8");

test("authentication throttle storage is privacy-bounded, indexed, and short-lived", () => {
  assert.match(migration, /primary key \(scope, key_digest\)/);
  assert.match(migration, /key_digest text not null check \(key_digest ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(migration, /authentication_throttle_expiry_idx/);
  assert.doesNotMatch(migration, /username\s+text|ip_address|network_address|user_agent/i);
  assert.match(throttle, /createHmac\("sha256"/);
  assert.match(throttle, /where expires_at < \$1 order by expires_at limit 100/);
});

test("attempt admission is an atomic cross-replica upsert and successes do not reset evidence", () => {
  assert.match(throttle, /on conflict \(scope, key_digest\) do update set/);
  assert.match(throttle, /attempt_count = case[\s\S]*attempt_count \+ 1/);
  assert.match(throttle, /failure_count = throttle\.failure_count \+ 1/);
  assert.match(throttle, /set last_success_at = \$\{nowParameter\}/);
  assert.doesNotMatch(throttle, /last_success_at[\s\S]{0,200}failure_count\s*=\s*0/);
});

test("sign-in, password replacement, and reauthentication share the throttle", () => {
  assert.equal(sessions.match(/beginAuthenticationAttempt\(/g)?.length, 3);
  assert.ok((sessions.match(/finishAuthenticationAttempt\(/g)?.length ?? 0) >= 6);
});
