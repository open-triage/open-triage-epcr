import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AssignedCallsController } from "../dist/calls/assigned-calls.controller.js";
import { AssignedCallsService } from "../dist/calls/assigned-calls.service.js";

const session = {
  accessToken: "authenticated-demo-token",
  user: { id: "32000000-0000-4000-8000-000000000003", displayName: "Synthetic Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "OpenTriage Synthetic EMS" },
  startedAt: "2026-09-03T08:00:00.000Z",
  expiresAt: "2026-09-03T22:00:00.000Z"
};

test("the authenticated call-list integration returns only the clinician's assigned unit calls", async () => {
  const queries = [];
  const dataSource = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      return [{
        id: "32000000-0000-4000-8000-000000000011",
        call_number: "SYN-2026-0903-001",
        unit_id: "32000000-0000-4000-8000-000000000010",
        call_sign: "Medic 32",
        dispatched_at: new Date("2026-09-03T12:00:00.000Z"),
        dispatch_reason: "Medical assistance requested",
        chief_complaint: null,
        status: "assigned"
      }];
    }
  };
  const sessions = { get: (token) => {
    assert.equal(token, session.accessToken);
    return session;
  } };
  const controller = new AssignedCallsController(new AssignedCallsService(dataSource, sessions));

  const result = await controller.list(`Bearer ${session.accessToken}`);

  assert.deepEqual(result.assignedCalls, [{
    id: "32000000-0000-4000-8000-000000000011",
    callNumber: "SYN-2026-0903-001",
    unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
    dispatchedAt: "2026-09-03T12:00:00.000Z",
    dispatchReason: "Medical assistance requested",
    chiefComplaint: null,
    status: "assigned"
  }]);
  assert.deepEqual(result.canceledAssignmentIds, []);
  assert.deepEqual(queries[0].parameters, [session.user.id, session.organization.id]);
  assert.match(queries[0].sql, /ca\.status in \('assigned', 'canceled'\)/);
  assert.match(queries[0].sql, /uc\.user_id = \$1/);
});

test("the assigned-call endpoint requires a current clinician session", async () => {
  const controller = new AssignedCallsController({ list: async () => ({ assignedCalls: [], canceledAssignmentIds: [], refreshedAt: "" }) });
  assert.throws(() => controller.list(), (error) => error instanceof UnauthorizedException);
});
