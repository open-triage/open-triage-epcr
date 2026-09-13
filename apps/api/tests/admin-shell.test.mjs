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
      if (sql.includes("with report_stats")) return [{
        available_calls: "3", ongoing_reports: "2", signed_reports: "14", signed_last_24_hours: "4",
        reports_with_errors: "1", active_users: "6", active_units: "2", database_size_bytes: "10485760",
        database_connections: "5", max_database_connections: "100"
      }];
      return [{
        form_version_id: "form-version-id", form_id: "form-id", form_name: "Stationary", catalog_name: "Agency Catalog",
        form_version: 4, catalog_release_id: "catalog-id", catalog_standard: "NEMSIS", catalog_version: "3.5.1"
      }];
    }
  }, {
    get: async (token) => {
      assert.equal(token, "opaque-session");
      return { ...session, capabilities: ["admin-dashboard:read"] };
    }
  });

  const context = await service.context("opaque-session");
  assert.ok(!Number.isNaN(Date.parse(context.dashboard.generatedAt)));
  assert.deepEqual({ ...context, dashboard: { ...context.dashboard, generatedAt: "measured" } }, {
    owner: session.user,
    organization: session.organization,
    capabilities: ["admin-dashboard:read"],
    panels: ["dashboard"],
    activeConfiguration: {
      catalog: { id: "catalog-id", name: "Agency Catalog", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "form-version-id", formId: "form-id", name: "Stationary", version: 4 }
    },
    dashboard: {
      availableCalls: 3, ongoingReports: 2, signedReports: 14, signedLast24Hours: 4,
      reportsWithErrors: 1, activeUsers: 6, activeUnits: 2, databaseSizeBytes: 10485760,
      databaseConnections: 5, maxDatabaseConnections: 100, generatedAt: "measured"
    }
  });
  assert.deepEqual(calls[0].parameters, [session.organization.id]);
  assert.match(calls[0].sql, /agency_stationary_default[\s\S]*active\.form_version_id = fv\.id/);
  assert.match(calls[1].sql, /pg_database_size\(current_database\(\)\)/);
  assert.match(calls[1].sql, /finding\.revision = report\.revision/);
});

test("direct admin access fails before configuration is queried without the capability", async () => {
  let queried = false;
  const service = new AdminService({ query: async () => { queried = true; return []; } }, {
    get: async () => ({ ...session, capabilities: ["clinical:document"] })
  });
  const controller = new AdminController(service, {});

  await assert.rejects(
    controller.context({ headers: {} }, "Bearer clinician-session"),
    UnauthorizedException
  );
  assert.equal(queried, false);
});

test("limited administrators receive only their authorized navigation without dashboard queries", async () => {
  let queried = false;
  const service = new AdminService({ query: async () => { queried = true; return []; } }, {
    get: async () => ({ ...session, capabilities: ["users:read"] })
  });
  const context = await service.context("opaque-session");
  assert.deepEqual(context.panels, ["users"]);
  assert.equal(context.dashboard, null);
  assert.equal(context.activeConfiguration, null);
  assert.equal(queried, false);
});
