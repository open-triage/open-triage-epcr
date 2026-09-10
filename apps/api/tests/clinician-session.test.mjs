import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { createPasswordVerifier, verifyPassword } from "../dist/identity/password.js";
import { bearerToken, SESSION_COOKIE } from "../dist/sessions/clinician-session.controller.js";
import { validateChangePassword } from "../dist/sessions/clinician-session.validation.js";

test("local password verifiers are salted, one-way, and reject the wrong password", async () => {
  const first = await createPasswordVerifier("A strong password! 253");
  const second = await createPasswordVerifier("A strong password! 253");
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /A strong password/);
  assert.equal(await verifyPassword("A strong password! 253", first), true);
  assert.equal(await verifyPassword("incorrect password", first), false);
  assert.equal(await verifyPassword("A strong password! 253", "malformed"), false);
});

test("cookie credentials take precedence and malformed authorization is rejected", () => {
  assert.equal(bearerToken("Bearer legacy", `${SESSION_COOKIE}=opaque-cookie; other=value`), "opaque-cookie");
  assert.equal(bearerToken("Bearer legacy"), "legacy");
  assert.throws(() => bearerToken(undefined), UnauthorizedException);
});

test("password replacement validates a strong new secret and a CSRF proof", () => {
  assert.deepEqual(validateChangePassword({
    currentPassword: "temporary password", newPassword: "replacement password!", csrfToken: "csrf-proof"
  }), { currentPassword: "temporary password", newPassword: "replacement password!", csrfToken: "csrf-proof" });
  assert.throws(() => validateChangePassword({ currentPassword: "old", newPassword: "short", csrfToken: "csrf" }), /12/);
  assert.throws(() => validateChangePassword({ currentPassword: "old", newPassword: "long enough password" }), /CSRF/);
});
