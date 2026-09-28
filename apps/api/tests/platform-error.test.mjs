import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { PlatformErrorFilter, identifyPlatformError } from "../dist/platform-error.filter.js";
import { validateCreateClinicianSession } from "../dist/sessions/clinician-session.validation.js";
import { validateProvisionAdminUser } from "../dist/admin/user-provisioning.validation.js";
import { validateCreateFeedback } from "../dist/feedback/feedback.validation.js";
import { validateCreateReportPhotoNoteCommand } from "../dist/reports/report-photo.validation.js";

function caught(command) {
  try { command(); assert.fail("expected rejected command"); } catch (error) { return error; }
}
function filtered(exception, path, language = "en") {
  let status;
  let body;
  new PlatformErrorFilter().catch(exception, { switchToHttp: () => ({
    getRequest: () => ({ path, headers: { "accept-language": language } }),
    getResponse: () => ({ status(value) { status = value; return { json(value) { body = value; } }; } })
  }) });
  return { status, body };
}

test("real rejected commands retain status and gain stable domain identities", () => {
  for (const [command, path, expected] of [
    [() => validateCreateClinicianSession({ username: "" }), "/api/sessions", "auth.http400"],
    [() => validateProvisionAdminUser({ organizationId: "forged" }), "/api/admin/users", "admin.http400"],
    [() => validateCreateFeedback({ type: "bug", description: "" }), "/api/feedback/v1/submissions", "feedback.http400"],
    [() => { try { validateCreateReportPhotoNoteCommand({}); } catch (error) { throw new UnprocessableEntityException({ message: error.message, findings: error.findings }); } }, "/api/reports/123/photos", "reports.http422"],
  ]) {
    const exception = caught(command);
    const { status, body } = filtered(exception, path);
    assert.equal(status, exception.getStatus());
    assert.equal(body.code, expected);
    assert.deepEqual(body.params, {});
    assert.equal(body.message, exception.message);
  }
});

test("named parameters, authorization, media conflict, and pinned findings are preserved", () => {
  const cases = [
    [new UnauthorizedException("The username or password is incorrect"), "/api/sessions", "auth.invalidCredentials", 401],
    [new BadRequestException("Temporary password duration must match the configured 24 hours"), "/api/admin/users", "admin.temporaryPasswordDuration", 400],
    [new ConflictException({ message: "The photo exceeds the report's remaining media allowance", remainingBytes: 1024 }), "/api/reports/r/photos", "media.allowanceExceeded", 409],
  ];
  for (const [exception, path, code, status] of cases) {
    const result = filtered(exception, path);
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
  }
  assert.deepEqual(filtered(cases[1][0], cases[1][1]).body.params, { hours: 24 });
  assert.deepEqual(filtered(cases[2][0], cases[2][1]).body.params, { remainingBytes: 1024 });
  const findings = [{ ruleId: "pinned", message: "Patient name is required" }];
  const result = filtered(new UnprocessableEntityException({ message: "Validation failed", findings }), "/api/reports/r/sign");
  assert.deepEqual(result.body.findings, findings);
  assert.equal(result.body.code, "reports.http422");
});

test("explicit identity is independent of English source wording", () => {
  assert.deepEqual(identifyPlatformError(409, "/api/calls/x", { code: "calls.changed", params: { revision: 7 }, message: "Arbitrary source text" }),
    { code: "calls.changed", params: { revision: 7 } });
});

test("agency language never changes API status, parameters, or canonical findings", () => {
  const findings = [{ ruleId: "r1", message: "Pinned authored wording" }];
  const exception = new UnprocessableEntityException({ message: "Validation failed", findings });
  assert.deepEqual(filtered(exception, "/api/reports/r/sign", "en"),
    filtered(exception, "/api/reports/r/sign", "sv"));
});
