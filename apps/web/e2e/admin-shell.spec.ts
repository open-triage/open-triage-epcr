import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

const assignedCall = demoAssignedCalls.assignedCalls[0] as AssignedCall;
const dashboard = {
  availableCalls: 3, ongoingReports: 2, signedReports: 14, signedLast24Hours: 4,
  reportsWithErrors: 1, activeUsers: 6, activeUnits: 2, databaseSizeBytes: 10_485_760,
  databaseConnections: 5, maxDatabaseConnections: 100, generatedAt: "2026-09-08T14:00:00.000Z",
};
function assignedCalls(route: Route) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() })
  });
}

async function signInAsCombinedOwner(page: Page,
  capabilities: ReadonlyArray<string> = ["clinical:document", "admin-dashboard:read"]) {
  await page.goto("/");
  await page.evaluate((grantedCapabilities) => {
    window.localStorage.clear();
    window.localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify({
      accessToken: "synthetic-browser-session",
      user: { id: "owner-id", displayName: "Installation Owner" },
      organization: { id: "organization-id", name: "Example EMS" },
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      capabilities: grantedCapabilities
    }));
    window.localStorage.removeItem("open-triage.presentation-mode.v1");
  }, capabilities);
  await page.reload();
}

const catalogDraft = {
  id: "catalog-draft-id", displayName: "Agency Catalog", sourceReleaseId: "catalog-id", revision: 4,
  definitionSha256: "a".repeat(64), updatedAt: "2026-09-08T14:00:00.000Z",
  definition: { schemaVersion: 1, sourceReleaseId: "catalog-id", elements: [{
    elementId: "ePatient.01", label: "Patient Care Report Number", identityId: "element-identity-id",
    baseDatatype: "string", storageSemantics: { sourceDatatype: "xs:string", groupPath: ["ePatient"],
      analyticalLocation: "wide", sqlType: "text" }, requirednessSeverity: null,
    constraints: { minOccurs: 0, maxOccurs: 1, nillable: true, supportsNotValues: true,
      supportsPertinentNegatives: false }
  }], codeLists: [] }
};

test("Catalog reader, writer, and publisher controls follow their independent authority", async ({ page }) => {
  await page.route("**/api/installation", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ profile: "production", settings: productionSettings }) }));
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" }, organization: { id: "organization-id", name: "Example EMS" },
    panels: ["dashboard", "catalog"], capabilities: ["admin-dashboard:read", "catalog:read"],
    activeConfiguration: { catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 } }, dashboard
  }) }));
  await page.route("**/api/admin/catalog-definition", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    id: "catalog-id", displayName: "NEMSIS 3.5.1", version: "3.5.1", status: "active", definition: catalogDraft.definition
  }) }));
  await page.route("**/api/admin/catalog-draft", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(catalogDraft) }));

  // Cached session claims deliberately retain stale publication authority; the
  // freshly resolved Admin context is the source of truth for visible actions.
  await signInAsCombinedOwner(page,
    ["admin-dashboard:read", "catalog:read", "catalog:write", "catalog:publish"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Element catalog", exact: true }).click();
  await expect(page.getByLabel("Label for ePatient.01")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish immutable catalog" })).toHaveCount(0);

  await page.unroute("**/api/admin/context");
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" }, organization: { id: "organization-id", name: "Example EMS" },
    panels: ["dashboard", "catalog"], capabilities: ["admin-dashboard:read", "catalog:read", "catalog:write"],
    activeConfiguration: { catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 } }, dashboard
  }) }));
  await signInAsCombinedOwner(page, ["admin-dashboard:read", "catalog:read", "catalog:write"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Element catalog", exact: true }).click();
  await expect(page.getByLabel("Label for ePatient.01")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish immutable catalog" })).toHaveCount(0);
  await expect(page.getByText("permits draft authoring but not publication or activation")).toBeVisible();

  await page.unroute("**/api/admin/context");
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" }, organization: { id: "organization-id", name: "Example EMS" },
    panels: ["dashboard", "catalog"], capabilities: ["admin-dashboard:read", "catalog:read", "catalog:write", "catalog:publish"],
    activeConfiguration: { catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 } }, dashboard
  }) }));
  await signInAsCombinedOwner(page,
    ["admin-dashboard:read", "catalog:read", "catalog:write", "catalog:publish"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Element catalog", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish immutable catalog" })).toBeVisible();
});

test("combined owners start clinically and can enter only server-authorized Admin panels by keyboard", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      owner: { id: "owner-id", displayName: "Installation Owner" },
      organization: { id: "organization-id", name: "Example EMS" },
      panels: ["dashboard"],
      activeConfiguration: {
        catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
        stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 }
      },
      dashboard,
    })
  }));
  await signInAsCombinedOwner(page);

  const selector = page.getByRole("group", { name: "Documentation presentation" });
  await expect(selector.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
  const admin = selector.getByRole("button", { name: "Admin" });
  await admin.focus();
  await admin.press("Enter");

  await expect(admin).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Active configuration" })).toBeVisible();
  await expect(page.getByText("NEMSIS 3.5.1", { exact: true })).toBeVisible();
  await expect(page.getByText("Agency Stationary, version 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Ongoing reports", { exact: true })).toBeVisible();
  await expect(page.getByText("10 MB", { exact: true })).toBeVisible();
  await expect(page.getByText("Used by new reports", { exact: true })).toHaveCount(0);
  await expect(page.locator(".session-identity")).toHaveText("Signed in as Installation Owner");
  await expect(page.getByRole("navigation", { name: "Administration panels" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Users", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Roles", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Element catalog", exact: true })).toHaveCount(0);
});

test("Users and Roles preserve asymmetric visibility and read-only accessible navigation", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/admin/")) requested.push(request.url()); });
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["users"], activeConfiguration: null, dashboard: null
  }) }));
  await page.route("**/api/admin/user-role-options", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [
    { id: "role-id", displayName: "Clinician", active: true, protected: true }
  ] }) }));
  await page.route("**/api/admin/users**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    items: [{ id: "user-id", displayName: "Alex Medic", username: "alex.medic", active: true,
      roles: [{ id: "role-id", displayName: "Clinician", active: true, protected: true }] }], nextCursor: null, pageSize: 50
  }) }));
  await signInAsCombinedOwner(page, ["users:read"]);
  await expect(page.getByRole("button", { name: "Admin" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Users", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "alex.medic" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Assigned roles" }).getByText("Clinician", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Roles", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create|Edit|Disable|Assign/ })).toHaveCount(0);
  expect(requested.some((url) => /\/api\/admin\/roles(?:\?|$)/.test(url))).toBe(false);

  requested.length = 0;
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["roles"], activeConfiguration: null, dashboard: null
  }) }));
  await page.route("**/api/admin/roles**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{
    id: "role-id", displayName: "Administrator", description: "Administrative access", active: true, protected: true,
    version: 2, assigneeCount: 4, capabilities: [{ key: "users:read", description: "View users", administrative: true, systemOnly: false }]
  }] }) }));
  await signInAsCombinedOwner(page, ["roles:read"]);
  await expect(page.getByRole("button", { name: "Roles", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("4", { exact: true })).toBeVisible();
  await expect(page.getByText("users:read", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Users", exact: true })).toHaveCount(0);
  expect(requested.some((url) => /\/api\/admin\/users(?:\?|$)/.test(url))).toBe(false);
});

test("an open clinical report disables Admin until Save and close", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment)
  }));
  await signInAsCombinedOwner(page);

  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.getByRole("button", { name: "Admin" })).toBeDisabled();
  await expect(page.locator(".admin-entry-blocked")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "mobile");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.getByRole("button", { name: "Admin" })).toBeEnabled();
});

test("a forged browser capability cannot bypass direct Admin API authorization", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({ status: 401, body: "Unauthorized" }));
  await signInAsCombinedOwner(page);
  await page.getByRole("button", { name: "Admin" }).click();
  await expect(page.locator(".admin-error")).toHaveText("Your account is not authorized to administer this installation.");
  await expect(page.getByRole("heading", { name: "Active configuration" })).toHaveCount(0);
});

test("owner edits and previews the unsaved form through Stationary without creating a clinical record", async ({ page }) => {
  const definition = { schemaVersion: 1, sections: [
    { key: "patient", presentation: { title: "Patient preview" }, fields: [
      { key: "last-name", source: { kind: "nemsis", elementId: "ePatient.02" }, required: true },
      { key: "age", source: { kind: "nemsis", elementId: "ePatient.15" } }
    ] },
    { key: "assessment", fields: [{ key: "impression", source: { kind: "nemsis", elementId: "eSituation.11" } }] }
  ] };
  const draft = { id: "draft-id", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "version-id",
    revision: 4, definitionSha256: "a".repeat(64), definition, diagnostics: [], updatedAt: new Date().toISOString() };
  const clinicalMutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/(reports|calls\/[^/]+\/open)/.test(request.url())) clinicalMutations.push(request.url());
  });
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" }, organization: { id: "organization-id", name: "Example EMS" },
    panels: ["dashboard", "catalog", "forms"],
    activeConfiguration: { catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 } },
    dashboard,
  }) }));
  await page.route("**/api/admin/catalog-draft", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/api/admin/form-draft", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(draft) }));
  await page.route("**/api/admin/form-drafts/draft-id/catalog-elements**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    items: [{ elementId: "ePatient.01", name: "Patient Care Report Number", description: "The patient care report number.",
      baseDatatype: "string", groupPath: ["ePatient"] }], nextOffset: null
  }) }));
  await signInAsCombinedOwner(page);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Stationary form", exact: true }).click();

  const editor = page.locator(".form-editor");
  await editor.getByRole("button", { name: "Add ePatient.01" }).click();
  await expect(editor.getByRole("button", { name: "ePatient.01 is already in the form" })).toBeDisabled();
  await editor.getByRole("button", { name: "Move ePatient.01 up" }).click();
  await expect(editor.getByText("Unsaved changes. Moved ePatient.01 up.", { exact: true })).toBeVisible();

  await editor.getByRole("button", { name: "Move assessment up" }).click();
  await expect(editor.getByText("Unsaved changes. Moved assessment up.", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Remove assessment" }).click();
  const removal = editor.getByRole("alertdialog", { name: "Remove assessment?" });
  await expect(removal).toContainText("impression (eSituation.11)");
  await removal.getByRole("button", { name: "Confirm removal" }).click();
  await expect(editor.getByRole("button", { name: "Remove assessment" })).toHaveCount(0);
  await expect(editor.getByText("Unsaved changes. Removed assessment and 1 affected field.", { exact: true })).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview Stationary form" }).click();
  const preview = await popupPromise;

  await expect(preview.getByRole("heading", { name: "Draft Stationary form" })).toBeVisible();
  await expect(preview.getByRole("navigation", { name: "Stationary record sections" }).getByText("Patient preview", { exact: true })).toBeVisible();
  await expect(preview.locator('[data-element-id="ePatient.02"]').first()).toBeVisible();
  await expect(preview.locator('[data-element-id="ePatient.01"]').first()).toBeVisible();
  await preview.locator('[data-element-id="ePatient.02"] input').first().fill("Preview surname");
  await preview.getByRole("button", { name: "Return to form draft" }).click();
  await expect.poll(() => preview.isClosed()).toBe(true);

  await expect(page.getByRole("button", { name: "Preview Stationary form" })).toBeVisible();
  await expect(page.getByText("Opened Stationary form preview in a new window.")).toBeVisible();
  await expect(page.locator(".form-fields").getByText("ePatient.02", { exact: true })).toBeVisible();
  expect(clinicalMutations).toEqual([]);
});
