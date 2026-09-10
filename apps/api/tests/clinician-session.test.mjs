import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import {
  ClinicianSessionService,
  DEMO_CLINICIAN_PASSWORD,
  DEMO_CLINICIAN_USERNAME
} from "../dist/sessions/clinician-session.service.js";
import { ClinicianSessionController } from "../dist/sessions/clinician-session.controller.js";

const clinician = {
  user_id: "32000000-0000-4000-8000-000000000003",
  display_name: "Synthetic Clinician",
  organization_id: "32000000-0000-4000-8000-000000000001",
  organization_name: "OpenTriage Synthetic EMS",
  shift_session_duration_hours: 14
};

function fixture() {
  const dataSource = { query: async () => [clinician] };
  const service = new ClinicianSessionService(dataSource);
  return { service, controller: new ClinicianSessionController(service) };
}

test("the externally observable session API signs in the seeded demo clinician for fourteen fixed hours", async () => {
  const { controller } = fixture();
  const session = await controller.create({
    username: DEMO_CLINICIAN_USERNAME,
    password: DEMO_CLINICIAN_PASSWORD
  });

  assert.equal(session.user.displayName, "Synthetic Clinician");
  assert.equal(Date.parse(session.expiresAt) - Date.parse(session.startedAt), 14 * 60 * 60 * 1_000);
  assert.deepEqual(controller.current(`Bearer ${session.accessToken}`), session);
});

test("a session expires at its original deadline without activity-based extension", async () => {
  const { service } = fixture();
  const start = new Date("2026-09-03T08:00:00.000Z");
  const session = await service.create({
    username: DEMO_CLINICIAN_USERNAME,
    password: DEMO_CLINICIAN_PASSWORD
  }, start);

  assert.equal(service.get(session.accessToken, new Date("2026-09-03T21:59:59.999Z")).expiresAt, "2026-09-03T22:00:00.000Z");
  assert.throws(
    () => service.get(session.accessToken, new Date("2026-09-03T22:00:00.000Z")),
    (error) => error instanceof UnauthorizedException
  );
});

test("manual logout invalidates the server session immediately", async () => {
  const { controller } = fixture();
  const session = await controller.create({
    username: DEMO_CLINICIAN_USERNAME,
    password: DEMO_CLINICIAN_PASSWORD
  });

  assert.deepEqual(controller.end(`Bearer ${session.accessToken}`), { ended: true });
  assert.throws(() => controller.current(`Bearer ${session.accessToken}`), UnauthorizedException);
});

test("incorrect demo credentials are rejected", async () => {
  const { controller } = fixture();
  await assert.rejects(
    controller.create({ username: DEMO_CLINICIAN_USERNAME, password: "incorrect" }),
    UnauthorizedException
  );
});

test("an expired session is pruned opportunistically by a later create(), without being looked up", async () => {
  const { service } = fixture();
  const start = new Date("2026-09-03T08:00:00.000Z");
  const expired = await service.create({
    username: DEMO_CLINICIAN_USERNAME,
    password: DEMO_CLINICIAN_PASSWORD
  }, start);

  assert.equal(service.sessions.has(expired.accessToken), true);

  // The shift is 14 hours long, so this is well past expiry. Creating another
  // session should sweep the expired entry out of the map on its own, with no
  // individual lookup of the expired token ever occurring.
  const afterExpiry = new Date("2026-09-04T08:00:00.000Z");
  await service.create({
    username: DEMO_CLINICIAN_USERNAME,
    password: DEMO_CLINICIAN_PASSWORD
  }, afterExpiry);

  assert.equal(service.sessions.has(expired.accessToken), false);
});

test("an active, non-expired session survives the opportunistic prune triggered by other creates", async () => {
  const { service } = fixture();
  const start = new Date("2026-09-03T08:00:00.000Z");
  const active = await service.create({
    username: DEMO_CLINICIAN_USERNAME,
    password: DEMO_CLINICIAN_PASSWORD
  }, start);

  // Still well within the 14 hour shift when the next session is created.
  const stillActiveAt = new Date("2026-09-03T09:00:00.000Z");
  await service.create({
    username: DEMO_CLINICIAN_USERNAME,
    password: DEMO_CLINICIAN_PASSWORD
  }, stillActiveAt);

  assert.equal(service.sessions.has(active.accessToken), true);
  assert.deepEqual(service.get(active.accessToken, stillActiveAt), active);
});
