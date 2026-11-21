import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";

const require = createRequire(import.meta.url);
const modulePath = require.resolve("../dist/reports/reports.module.js");

test("only the development API registers FHIR validation and its worker lifecycle", t => {
  const previous = process.env.NODE_ENV;
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    delete require.cache[modulePath];
  });

  for (const environment of ["development", "production", undefined]) {
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
    delete require.cache[modulePath];
    const { ReportsModule } = require(modulePath);
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ReportsModule);
    const routes = controllers.flatMap(controller =>
      Object.getOwnPropertyNames(controller.prototype).flatMap(name => {
        const path = Reflect.getMetadata(PATH_METADATA, controller.prototype[name]);
        return typeof path === "string" && path.includes("fhir-validation") ? [path] : [];
      }));
    assert.deepEqual(routes.sort(), environment === "development"
      ? [":id/demo/fhir-validation", ":id/demo/fhir-validation/:jobId"] : []);
  }
});
