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
