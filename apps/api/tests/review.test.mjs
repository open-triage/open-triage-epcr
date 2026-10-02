import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ReviewService } from "../dist/review/review.service.js";
import { reviewScope } from "../dist/review/review-scope.js";

const session = (capabilities, userId = "user-a", organizationId = "org-a") => ({
  capabilities, user: { id: userId }, organization: { id: organizationId },
});

test("Review scope separates report access, identifying content, and administration", () => {
  assert.throws(() => reviewScope(session(["review:identifying"])), ForbiddenException);
  assert.deepEqual(reviewScope(session(["review:self", "review:identifying"])), {
    organizationId: "org-a", userId: "user-a", reports: "own", identifying: true,
    administrator: false, defaultDataset: "real",
  });
  assert.deepEqual(reviewScope(session(["review:all", "review:admin", "clinical:demo"])), {
    organizationId: "org-a", userId: "user-a", reports: "all", identifying: false,
    administrator: true, defaultDataset: "synthetic",
  });
});

test("signed report query applies organization, user, signature and dataset scope on every page", async () => {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    return sql.includes("count(*)") ? [{ total: "1" }] : [{
      id: "report-a", reporting_date: "2026-10-02", signed_at: "2026-10-02T08:00:00Z", author_name: null,
    }];
  } };
  let current = session(["review:self"]);
  const service = new ReviewService(database, { get: async () => current });
  const first = await service.signedReports("token");
  assert.equal(first.dataset, "real");
  assert.equal(first.scope, "own");
  assert.equal(first.reports[0].documentingClinician, undefined);
  assert.equal(calls.length, 2);
  for (const { sql, params } of calls) {
    assert.match(sql, /r\.organization_id = \$1/);
    assert.match(sql, /r\.synthetic = \$2/);
    assert.match(sql, /r\.status = 'signed'/);
    assert.match(sql, /r\.documenting_user_id = \$3/);
    assert.deepEqual(params.slice(0, 4), ["org-a", false, "user-a", false]);
  }
  calls.length = 0;
  current = session(["review:all", "review:identifying", "clinical:demo"], "user-b", "org-b");
  const second = await service.signedReports("token", undefined, "2", "10");
  assert.equal(second.dataset, "synthetic");
  assert.equal(second.scope, "all");
  assert.deepEqual(calls[1].params, ["org-b", true, "user-b", true, 10, 10, true]);
  await assert.rejects(service.signedReports("token", "both"), BadRequestException);
  await assert.rejects(service.signedReports("token", "real", "0"), BadRequestException);
});
