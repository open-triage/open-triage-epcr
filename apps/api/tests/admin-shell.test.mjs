import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AdminController } from "../dist/admin/admin.controller.js";
import { AdminService } from "../dist/admin/admin.service.js";

const session = {
  user: { id: "owner-id", displayName: "Installation Owner" },
  organization: { id: "organization-id", name: "Example EMS" }
};

test("admin context is resolved from the authorized session organization", async () => {
  const calls = [];
  const service = new AdminService({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return [{
        form_version_id: "form-version-id", form_id: "form-id", form_name: "Stationary",
        form_version: 4, catalog_release_id: "catalog-id", catalog_standard: "NEMSIS", catalog_version: "3.5.1"
      }];
    }
  }, {
    requireCapability: async (token, capability) => {
      assert.equal(token, "opaque-session");
      assert.equal(capability, "installation:administer");
      return session;
    }
  });

  assert.deepEqual(await service.context("opaque-session"), {
    owner: session.user,
    organization: session.organization,
    activeConfiguration: {
      catalog: { id: "catalog-id", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "form-version-id", formId: "form-id", name: "Stationary", version: 4 }
    }
  });
  assert.deepEqual(calls[0].parameters, [session.organization.id]);
  assert.match(calls[0].sql, /operational_unit[\s\S]*default_form_id/);
});

test("direct admin access fails before configuration is queried without the capability", async () => {
  let queried = false;
  const service = new AdminService({ query: async () => { queried = true; return []; } }, {
    requireCapability: async () => { throw new UnauthorizedException("The requested capability is required"); }
  });
  const controller = new AdminController(service);

  await assert.rejects(
    controller.context({ headers: {} }, "Bearer clinician-session"),
    UnauthorizedException
  );
  assert.equal(queried, false);
});
