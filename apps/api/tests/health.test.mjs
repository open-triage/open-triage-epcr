import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { HealthController } from "../dist/health.controller.js";

test("development health details identify the checkout and database without exposing a URL", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const controller = new HealthController({ query: async () => [{
      database_name: "open_triage_feature", postgres_version: "17.4"
    }] });
    const details = await controller.getDevelopmentDetails();
    assert.equal(details.database.name, "open_triage_feature");
    assert.equal(details.runtime.workingDirectory, process.cwd());
    assert.doesNotMatch(JSON.stringify(details), /DATABASE_URL|password|postgres:\/\//i);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("runtime identity details are unavailable in production", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const controller = new HealthController({ query: async () => { throw new Error("must not query"); } });
    await assert.rejects(controller.getDevelopmentDetails(), NotFoundException);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
