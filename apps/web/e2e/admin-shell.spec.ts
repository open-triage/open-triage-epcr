import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

test.use({ timezoneId: "Europe/Stockholm" });

const assignedCall = demoAssignedCalls.assignedCalls[0] as AssignedCall;
const dashboard = {
  availableCalls: 3, ongoingReports: 2, signedReports: 14, signedLast24Hours: 4,
  reportsWithErrors: 1, activeUsers: 6, activeUnits: 2, databaseSizeBytes: 10_485_760,
  databaseConnections: 5, maxDatabaseConnections: 100, generatedAt: "2026-09-08T14:00:00.000Z",
};
const agencySettings = {
  organizationId: "organization-id", language: "en", reportMediaAllowanceBytes: 50 * 1024 * 1024,
  defaultReportMediaAllowanceBytes: 50 * 1024 * 1024, storageGrowthWarning: false, revision: 4,
  updatedAt: "2026-09-24T10:00:00.000Z",
  appearance: {
    brandText: "Example EMS", helperText: "Use your agency-issued credentials.", logoPngDataUrl: null,
    accentColor: "#00783a", accentDarkColor: "#006b34", browserThemeColor: "#00783a",
    pwaBackgroundColor: "#dfe5df", pwaName: "Example EMS", pwaShortName: "EMS",
  },
  demographics: {
    agencyUniqueStateId: "STATE-1", agencyNumber: "AGENCY-1", stateCode: "36", stateDisplay: "New York",
    stateCodeSystem: "ANSI-STATE", stateTerminologyVersion: null, versionId: "version-id", version: 2,
    catalogReleaseId: "catalog-id", effectiveFrom: "2026-09-24T10:00:00.000Z",
  },
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
  await page.evaluate((authorizedCapabilities) => {
    window.localStorage.clear();
    window.localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify({
      accessToken: "synthetic-browser-session",
      user: { id: "owner-id", displayName: "Installation Owner" },
      organization: { id: "organization-id", name: "Example EMS" },
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      capabilities: authorizedCapabilities
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

test("admin drafts retain edits and filters across tabs and validation deletion accepts an empty success", async ({ page }) => {
  const formDraft = { id: "form-draft-id", displayName: "UX regression form", formId: "form-id", catalogReleaseId: "catalog-id",
    clonedFromId: null, revision: 4, definitionSha256: "a".repeat(64), diagnostics: [], updatedAt: new Date().toISOString(),
    definition: { schemaVersion: 1, sections: [
      { key: "patient", fields: [{ key: "name", source: { kind: "nemsis", elementId: "ePatient.02" } },
        { key: "age", source: { kind: "nemsis", elementId: "ePatient.15" } }] },
      { key: "assessment", fields: [{ key: "impression", source: { kind: "nemsis", elementId: "eSituation.11" } }] },
    ] } };
  const validationDraft = { id: "validation-draft-id", catalogReleaseId: "catalog-id", clonedFromId: null,
    revision: 2, displayName: "UX regression rules", rules: [], updatedAt: new Date().toISOString() };
  const capabilities = ["clinical:document", "admin-dashboard:read", "forms:read", "forms:write", "validation:read", "validation:write"];
  let formLoads = 0;
  let validationLoads = 0;
  let catalogSearches = 0;
  let deleted = false;
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/admin/", "");
    if (path === "context") return route.fulfill({ json: {
      organization: { id: "organization-id", name: "Example EMS" }, panels: ["dashboard", "forms", "validation"], capabilities,
      dashboard, activeConfiguration: { catalog: { id: "catalog-id", name: "Test catalog", standard: "NEMSIS", version: "3.5.1" },
        stationaryForm: { id: "version-id", formId: "form-id", name: "Test form", version: 1 } },
    } });
    if (path === "form-draft") { formLoads += 1; return route.fulfill({ json: formDraft }); }
    if (path === "validation-draft") { validationLoads += 1; return route.fulfill({ json: deleted ? null : validationDraft }); }
    if (path === "validation-drafts/validation-draft-id" && route.request().method() === "DELETE") {
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: 2 });
      deleted = true; return route.fulfill({ status: 204 });
    }
    if (path === "form-drafts/form-draft-id/catalog-elements") {
      catalogSearches += 1; return route.fulfill({ json: { items: [], nextOffset: null } });
    }
    if (path === "catalog-definition" || path === "catalog-versions/catalog-id") return route.fulfill({ json: {
      id: "catalog-id", displayName: "Test catalog", version: 1, status: "active", definition: catalogDraft.definition,
    } });
    if (path === "validation-rules") return route.fulfill({ json: { items: [], nextCursor: null, total: 0 } });
    return route.fulfill({ json: [] });
  });
  await signInAsCombinedOwner(page, capabilities);
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "Form editor", exact: true }).click();
  const editor = page.locator(".form-editor");
  await expect(editor.getByRole("group", { name: "Form draft actions" })).toBeVisible();
  await expect(editor.locator(".form-section-toggle[aria-expanded=true]")).toHaveCount(1);
  await expect(editor.getByRole("button", { name: "Move eSituation.11 up", exact: true })).toHaveCount(0);
  expect(catalogSearches).toBe(0);
  await editor.getByLabel("Go to section").selectOption("assessment");
  await expect(editor.getByRole("button", { name: "Move eSituation.11 up", exact: true })).toBeVisible();
  await editor.getByLabel("Go to section").selectOption("patient");
  await editor.getByRole("button", { name: "Move ePatient.02 down", exact: true }).click();
  await editor.getByLabel("Find by identifier, name, or description").fill("patient name");
  await expect.poll(() => catalogSearches).toBe(1);
  const initialFormLoads = formLoads;
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("button", { name: "Form editor", exact: true }).click();
  await expect(editor.getByLabel("Find by identifier, name, or description")).toHaveValue("patient name");
  await expect(editor.getByRole("button", { name: "Save form draft", exact: true })).toBeEnabled();
  await expect(editor.locator(".form-section ol li").first()).toContainText("ePatient.15");
  expect(formLoads).toBe(initialFormLoads);

  await page.getByRole("button", { name: "Validation rules", exact: true }).click();
  const deleteButton = page.getByRole("button", { name: "Delete draft", exact: true });
  await expect(deleteButton).toBeVisible();
  const initialValidationLoads = validationLoads;
  page.once("dialog", (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(page.getByText("Validation draft deleted. You can now start a draft from a selected version.")).toBeVisible();
  await expect(deleteButton).toHaveCount(0);
  expect(deleted).toBe(true);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Validation rules", exact: true }).click();
  await expect(deleteButton).toHaveCount(0);
  await expect(page.getByText("The administration server returned an empty response.")).toHaveCount(0);
  expect(validationLoads).toBe(initialValidationLoads);
});

test("Demo can inspect Agency Settings without write controls", async ({ page }) => {
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({ json: {
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["settings"],
    capabilities: ["clinical:demo", "clinical:document", "settings:read"],
    activeConfiguration: null, dashboard: null,
  } }));
  await page.route("**/api/admin/agency-settings", (route) => route.fulfill({ json: agencySettings }));

  await signInAsCombinedOwner(page, ["clinical:demo", "clinical:document", "settings:read"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await expect(page.getByRole("button", { name: "Agency Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Agency Settings" }).click();
  await expect(page.getByRole("heading", { name: "Agency Settings" })).toBeVisible();
  await expect(page.locator(".agency-settings fieldset")).toHaveCount(6);
  for (const fieldset of await page.locator(".agency-settings fieldset").all()) await expect(fieldset).toHaveAttribute("disabled", "");
  await expect(page.getByText(/changing them requires settings:write authority/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("Catalog reader, writer, and publisher controls follow their independent authority", async ({ page }) => {
  await page.route("**/api/installation", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ settings: productionSettings }) }));
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

test("Forms readers, authors, and publishers receive only their permitted controls", async ({ page }) => {
  const definition = { schemaVersion: 1, sections: [{ key: "patient", fields: [
    { key: "last-name", source: { kind: "nemsis", elementId: "ePatient.02" } }
  ] }] };
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id",
    clonedFromId: "version-id", revision: 4, definitionSha256: "a".repeat(64), definition, diagnostics: [],
    catalogFields: {}, updatedAt: new Date().toISOString() };
  await page.route("**/api/installation", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ settings: productionSettings }) }));
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  let resolvedCapabilities = ["admin-dashboard:read", "forms:read"];
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" }, organization: { id: "organization-id", name: "Example EMS" },
    panels: ["dashboard", "forms"], capabilities: resolvedCapabilities,
    activeConfiguration: { catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 } }, dashboard
  }) }));
  await page.route("**/api/admin/form-draft", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(draft) }));
  await page.route("**/api/admin/form-drafts/draft-id/catalog-elements**", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ items: [], nextOffset: null }) }));

  // Cached session claims deliberately retain stale publication authority; the
  // freshly resolved Admin context must suppress mutation controls immediately.
  await signInAsCombinedOwner(page, ["admin-dashboard:read", "forms:read", "forms:write", "forms:publish"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Form editor", exact: true }).click();
  await expect(page.getByText("read-only access to this form definition")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save form draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete form draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish immutable form" })).toHaveCount(0);
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview form" }).click();
  const preview = await previewPromise;
  await expect(preview.getByRole("heading", { name: "Draft form" })).toBeVisible({ timeout: 15_000 });
  await preview.close();

  await page.route("**/api/admin/form-drafts/draft-id", (route) => route.fulfill({ status: 409,
    contentType: "application/json", body: JSON.stringify({ code: "admin.http409", message: "Form draft revision is stale", actualRevision: 5 }) }));
  resolvedCapabilities = ["admin-dashboard:read", "forms:read", "forms:write"];
  await signInAsCombinedOwner(page, ["admin-dashboard:read", "forms:read", "forms:write"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Form editor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save form draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete form draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish immutable form" })).toHaveCount(0);
  await expect(page.getByText("permits draft authoring but not publication or activation")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete form draft" }).click();
  await expect(page.getByText("Administration: the information changed; refresh and try again.", { exact: true })).toBeVisible();

  resolvedCapabilities = ["admin-dashboard:read", "forms:read", "forms:write", "forms:publish"];
  await signInAsCombinedOwner(page, ["admin-dashboard:read", "forms:read", "forms:write", "forms:publish"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Form editor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish immutable form" })).toBeVisible();
});

test("Validation readers can inspect drafts while write and publish controls follow dedicated authority", async ({ page }) => {
  const validationDraft = {
    id: "51000000-0000-4000-8000-000000000001", catalogReleaseId: "catalog-id", revision: 3,
    displayName: "Agency required fields", updatedAt: new Date().toISOString(),
    rules: [{ id: "52000000-0000-4000-8000-000000000001", name: "Require incident number",
      enabled: true, severity: "error", executionTargets: ["live", "sign"],
      primaryTargetElementId: "eResponse.03", message: "Incident number is required",
      source: 'assert present("eResponse.03")' }]
  };
  await page.route("**/api/installation", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ settings: productionSettings }) }));
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  let resolvedCapabilities = ["validation:read"];
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" }, organization: { id: "organization-id", name: "Example EMS" },
    panels: ["validation"], capabilities: resolvedCapabilities,
    activeConfiguration: { catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 } }, dashboard: null
  }) }));
  await page.route("**/api/admin/validation-draft", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify(validationDraft) }));
  await page.route("**/api/admin/catalog-definition", (route) => route.fulfill({ json: {
    id: "catalog-id", displayName: "NEMSIS 3.5.1", version: "3.5.1", status: "active", definition: catalogDraft.definition
  } }));
  await page.route("**/api/admin/catalog-versions/catalog-id", (route) => route.fulfill({ json: {
    id: "catalog-id", displayName: "NEMSIS 3.5.1", version: "3.5.1", status: "active", definition: catalogDraft.definition
  } }));
  await page.route("**/api/admin/validation-versions", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/form-versions", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/validation-rules**", (route) => route.fulfill({ json: { items: [], total: 0, nextCursor: null } }));

  await signInAsCombinedOwner(page, ["validation:read", "validation:write", "validation:publish"]);
  await page.getByRole("button", { name: "Admin" }).click();
  await expect(page.getByRole("button", { name: "Validation rules", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validation rules", exact: true }).click();
  await expect(page.getByLabel("Validation version display name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Validate draft" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save Validation draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish immutable Validation version" })).toHaveCount(0);

  resolvedCapabilities = ["validation:read", "validation:write"];
  await signInAsCombinedOwner(page, resolvedCapabilities);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Validation rules", exact: true }).click();
  await expect(page.getByLabel("Validation version display name")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save Validation draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish immutable Validation version" })).toHaveCount(0);

  resolvedCapabilities = ["validation:read", "validation:write", "validation:publish"];
  await signInAsCombinedOwner(page, resolvedCapabilities);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Validation rules", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish immutable Validation version" })).toBeVisible();
});

test("combined owners start clinically and can enter only server-authorized Admin panels by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1048, height: 1008 });
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
  await selector.getByRole("button", { name: "Stationary" }).click();
  const logOut = page.getByRole("button", { name: "Log out" });
  const clinicalSelectorBox = await selector.boundingBox();
  const clinicalLogOutBox = await logOut.boundingBox();
  expect(clinicalSelectorBox).not.toBeNull();
  expect(clinicalLogOutBox).not.toBeNull();
  const admin = selector.getByRole("button", { name: "Admin" });
  await admin.focus();
  await admin.press("Enter");

  await expect(admin).toHaveAttribute("aria-pressed", "true");
  const adminSelectorBox = await selector.boundingBox();
  const adminLogOutBox = await logOut.boundingBox();
  expect(adminSelectorBox).not.toBeNull();
  expect(adminLogOutBox).not.toBeNull();
  expect(adminSelectorBox).toEqual(clinicalSelectorBox);
  expect(adminLogOutBox).toEqual(clinicalLogOutBox);
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
  await expect(page.getByRole("columnheader", { name: /4 assignees/ })).toBeVisible();
  await expect(page.getByText("users:read", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Users", exact: true })).toHaveCount(0);
  expect(requested.some((url) => /\/api\/admin\/users(?:\?|$)/.test(url))).toBe(false);
});

test("an authorized administrator provisions a user with initial roles and bounded temporary expiry", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  const users: Array<{ id: string; displayName: string; username: string; active: boolean;
    owner: boolean; roles: Array<{ id: string; displayName: string; active: boolean; protected: boolean }> }> = [
    { id: "owner-id", displayName: "Installation Owner", username: "owner", active: true, owner: true, roles: [] }
  ];
  await page.route("**/api/installation", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ settings: productionSettings }) }));
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["users"],
    capabilities: ["users:read", "users:write", "roles:read", "roles:assign"], activeConfiguration: null, dashboard: null
  }) }));
  await page.route("**/api/admin/user-role-options", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [
    { id: "10000000-0000-4000-8000-000000000001", displayName: "Clinician", active: true, protected: true,
      assignmentRestricted: false, assignmentMutable: true }
  ] }) }));
  await page.route("**/api/admin/users**", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      users.push({ id: "new-user", displayName: "Åke Medic", username: "ake.medic", active: true, owner: false,
        roles: [{ id: "10000000-0000-4000-8000-000000000001", displayName: "Clinician", active: true, protected: true }] });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ userId: "new-user",
        username: "ake.medic", displayName: "Åke Medic", roleIds: ["10000000-0000-4000-8000-000000000001"],
        temporaryPasswordExpiresAt: "2026-09-14T10:00:00.000Z" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: users, nextCursor: null, pageSize: 50 }) });
  });
  await signInAsCombinedOwner(page, ["users:read", "users:write", "roles:read", "roles:assign"]);
  await expect(page.getByRole("row", { name: /Installation Owner/ })
    .getByRole("list", { name: "Assigned roles" })).toContainText("Owner");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  const form = page.getByRole("group", { name: "New local user" });
  await form.getByLabel("Display name").fill("Åke Medic");
  await form.getByLabel("Username").fill("ake.medic");
  await form.getByLabel("Temporary password").fill("Temporary password 42!");
  await form.getByLabel("Clinician").check();
  await form.getByLabel("Note (optional)").fill("New starter");
  await form.getByRole("button", { name: "Create user", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Åke Medic was created");
  await expect(page.getByRole("cell", { name: "ake.medic" })).toBeVisible();
  expect(submitted).toEqual({ username: "ake.medic", displayName: "Åke Medic",
    temporaryPassword: "Temporary password 42!", temporaryPasswordHours: 72,
    roleIds: ["10000000-0000-4000-8000-000000000001"], note: "New starter" });
  await expect(page.getByText("Temporary password 42!", { exact: true })).toHaveCount(0);
});

test("an administrator reviews retained roles while disabling and reactivating a durable identity", async ({ page }) => {
  const role = { id: "10000000-0000-4000-8000-000000000001", displayName: "Clinician", active: true, protected: true,
    assignmentRestricted: false, assignmentMutable: true };
  let user = { id: "20000000-0000-4000-8000-000000000001", displayName: "Alex Medic",
    username: "alex.medic", active: true, revision: 4, roles: [role] };
  const commands: Array<Record<string, unknown>> = [];
  await page.route("**/api/installation", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ settings: productionSettings }) }));
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["users"], capabilities: ["users:read", "users:write", "roles:read", "roles:assign"],
    activeConfiguration: null, dashboard: null
  }) }));
  await page.route("**/api/admin/user-role-options", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ items: [role] }) }));
  await page.route("**/api/admin/users**", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      commands.push(body);
      const wasActive = user.active;
      user = { ...user, username: String(body.username), displayName: String(body.displayName),
        active: Boolean(body.active), revision: user.revision + 1 };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...user,
        restoredRoles: !wasActive && user.active ? [role] : [], sessionsRevoked: wasActive && !user.active ? 2 : 0,
        freshLoginRequired: wasActive !== user.active }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [user], nextCursor: null, pageSize: 50 }) });
  });
  await signInAsCombinedOwner(page, ["users:read", "users:write", "roles:read", "roles:assign"]);

  await page.getByRole("button", { name: "Manage" }).click();
  const manage = page.getByRole("region", { name: "Manage Alex Medic" });
  await manage.getByLabel("Display name").fill("Alex Renamed");
  await manage.getByLabel("Username").fill("alex.renamed");
  await manage.getByLabel("Status").selectOption("false");
  await expect(manage.getByText(/immediately revokes every active session/i)).toBeVisible();
  await manage.getByRole("button", { name: "Save user" }).click();
  await expect(page.getByRole("status")).toContainText("2 active sessions were revoked");
  expect(commands[0]).toMatchObject({ expectedRevision: 4, username: "alex.renamed", displayName: "Alex Renamed",
    active: false });
  expect(commands[0]).not.toHaveProperty("roleIds");

  await page.getByRole("button", { name: "Manage" }).click();
  const reactivate = page.getByRole("region", { name: "Manage Alex Renamed" });
  await reactivate.getByLabel("Status").selectOption("true");
  await expect(reactivate.getByText("Roles restored on reactivation")).toBeVisible();
  await expect(reactivate.getByRole("list", { name: "Assigned roles" })).toContainText("Clinician");
  await expect(reactivate.getByText(/credential will not be reset/i)).toBeVisible();
  await reactivate.getByRole("button", { name: "Reactivate user" }).click();
  await expect(page.getByRole("status")).toContainText("A fresh login is required; the credential was not reset");
  expect(commands[1]).toMatchObject({ expectedRevision: 5, active: true });
  expect(commands[1]).not.toHaveProperty("roleIds");
});

test("user management remains one pane and refreshes identity fields when switching users", async ({ page }) => {
  const role = { id: "10000000-0000-4000-8000-000000000001", displayName: "Clinician", active: true,
    protected: true, assignmentRestricted: false, assignmentMutable: true };
  const users = [
    { id: "20000000-0000-4000-8000-000000000001", displayName: "Alex Medic", username: "alex.medic",
      active: true, revision: 1, owner: false, roles: [role] },
    { id: "20000000-0000-4000-8000-000000000002", displayName: "Blake Medic", username: "blake.medic",
      active: true, revision: 1, owner: false, roles: [role] }
  ];
  await page.route("**/api/installation", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ settings: productionSettings }) }));
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["users"],
    capabilities: ["users:read", "users:write", "roles:read", "roles:assign", "sessions:read"],
    activeConfiguration: null, dashboard: null
  }) }));
  await page.route("**/api/admin/user-role-options", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ items: [role] }) }));
  await page.route("**/api/admin/users/*/sessions", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/admin/users**", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ items: users, nextCursor: null, pageSize: 50 }) }));
  await signInAsCombinedOwner(page,
    ["users:read", "users:write", "roles:read", "roles:assign", "sessions:read"]);

  const alexRow = page.getByRole("row", { name: /Alex Medic/ });
  await alexRow.getByRole("button", { name: "Manage" }).click();
  const alexPane = page.getByRole("region", { name: "Manage Alex Medic" });
  await expect(alexPane.getByLabel("Display name")).toHaveValue("Alex Medic");
  await expect(alexPane.getByLabel("Username")).toHaveValue("alex.medic");
  await expect(alexPane.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await expect(page.locator(".admin-user-management")).toHaveCount(1);

  const blakeRow = page.getByRole("row", { name: /Blake Medic/ });
  await blakeRow.getByRole("button", { name: "Manage" }).click();
  const blakePane = page.getByRole("region", { name: "Manage Blake Medic" });
  await expect(blakePane.getByLabel("Display name")).toHaveValue("Blake Medic");
  await expect(blakePane.getByLabel("Username")).toHaveValue("blake.medic");
  await expect(page.locator(".admin-user-management")).toHaveCount(1);
});

test("a temporary credential opens only mandatory password replacement", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify({
    accessToken: "temporary-session", user: { id: "new-user", displayName: "New User" },
    organization: { id: "organization-id", name: "Example EMS" }, startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(), passwordChangeRequired: true,
    capabilities: ["clinical:document"], workspaceAvailable: true
  })));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Replace temporary password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open call" })).toHaveCount(0);
});

test("a role author creates an immediately active immutable version from the safe capability registry", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["roles"],
    capabilities: ["roles:read", "roles:write", "users:read", "users:write"],
    activeConfiguration: null, dashboard: null
  }) }));
  await page.route("**/api/admin/role-capabilities", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [
    { key: "users:read", description: "View users", administrative: true, systemOnly: false, prerequisites: [], mutable: true },
    { key: "users:write", description: "Change users", administrative: true, systemOnly: false,
      prerequisites: ["users:read"], mutable: true },
    { key: "clinical:document", description: "Document care", administrative: false, systemOnly: false,
      prerequisites: [], mutable: false }
  ] }) }));
  await page.route("**/api/admin/roles**", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "custom-role-id",
        displayName: "Dispatch Lead", description: "Coordinates dispatch", active: true, protected: false,
        version: 1, assigneeCount: 0, capabilities: [
          { key: "users:read", description: "View users", administrative: true, systemOnly: false },
          { key: "users:write", description: "Change users", administrative: true, systemOnly: false }
        ] }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await signInAsCombinedOwner(page, ["roles:read", "roles:write", "users:read", "users:write"]);
  await page.getByRole("button", { name: "Create custom role" }).click();
  await page.getByLabel("Role name").fill(" Dispatch   Lead ");
  await page.getByLabel("Description (optional)").fill("Coordinates dispatch");
  await page.getByRole("checkbox", { name: /^users:write/ }).check();
  await expect(page.getByRole("checkbox", { name: /^users:read/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^clinical:document/ })).toBeDisabled();
  await page.getByLabel(/Change note/).fill("Approved operational access");
  await page.getByRole("button", { name: "Save and activate" }).click();
  await expect(page.getByRole("columnheader", { name: /Dispatch Lead/ })).toBeVisible();
  expect(submitted).toMatchObject({ capabilityKeys: ["users:read", "users:write"], note: "Approved operational access" });
  expect(submitted).not.toHaveProperty("expectedVersion");
});

test("a role author deactivates, inspects redacted history, and reactivates without assignments", async ({ page }) => {
  const role = { id: "30000000-0000-4000-8000-000000000001", displayName: "Dispatch Lead",
    description: "Coordinates dispatch", active: true, protected: false, version: 1, assigneeCount: 1,
    capabilities: [{ key: "roles:read", description: "View roles", administrative: true, systemOnly: false }] };
  let retired = false;
  let deactivateBody: Record<string, unknown> | undefined;
  let reactivateBody: Record<string, unknown> | undefined;
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" }, panels: ["roles"],
    capabilities: ["roles:read", "roles:write"], activeConfiguration: null, dashboard: null
  }) }));
  await page.route("**/api/admin/role-capabilities", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ items: [{ key: "roles:read", description: "View roles", administrative: true,
      systemOnly: false, prerequisites: [], mutable: true }] }) }));
  await page.route("**/api/admin/roles**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/deactivate")) {
      deactivateBody = route.request().postDataJSON() as Record<string, unknown>;
      retired = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...role, active: false, assigneeCount: 0 }) });
      return;
    }
    if (url.endsWith("/reactivate")) {
      reactivateBody = route.request().postDataJSON() as Record<string, unknown>;
      retired = false;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...role,
        displayName: "Dispatch Legacy", active: true, version: 2, assigneeCount: 0 }) });
      return;
    }
    if (url.endsWith("/history")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ roleId: role.id,
        versions: [{ id: "version-1", version: 1, displayName: role.displayName, description: role.description,
          createdAt: "2026-09-11T10:00:00.000Z", createdBy: "owner-id", note: null, capabilityKeys: ["roles:read"] }],
        assignments: [{ id: "assignment-1", userId: "redacted-user-id", assignedAt: "2026-09-11T10:00:00.000Z",
          assignedBy: "owner-id", endedAt: "2026-09-11T11:00:00.000Z", endedBy: "owner-id", note: null }],
        events: [{ id: "event-1", action: "role.deactivate", occurredAt: "2026-09-11T11:00:00.000Z",
          note: "Duty retired", details: { roleId: role.id, version: 1, endedAssignmentCount: 1 } }] }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items:
      retired || new URL(url).searchParams.get("state") !== "active" ? [{ ...role, active: false, assigneeCount: 0 }] : [role] }) });
  });
  await signInAsCombinedOwner(page, ["roles:read", "roles:write"]);
  await page.getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByText("immediately ends 1 current assignment")).toBeVisible();
  await page.getByLabel(/Retirement note/).fill("Duty retired");
  await page.getByRole("button", { name: "Confirm deactivation" }).click();
  expect(deactivateBody).toEqual({ expectedVersion: 1, note: "Duty retired" });

  await page.getByLabel("Status").selectOption("disabled");
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText(`Stable role ID: ${role.id}`)).toBeVisible();
  await expect(page.getByText(/redacted-user-id/)).toBeVisible();
  await expect(page.getByText(/Version 1: Dispatch Lead/)).toBeVisible();
  await expect(page.getByText(/Note: Duty retired/)).toBeVisible();
  const localHistoryTime = await page.evaluate(() => new Date("2026-09-11T11:00:00.000Z").toLocaleString());
  await expect(page.locator('time[datetime="2026-09-11T11:00:00.000Z"]')).toHaveCount(2);
  for (const time of await page.locator('time[datetime="2026-09-11T11:00:00.000Z"]').all()) {
    await expect(time).toHaveText(localHistoryTime);
  }
  await page.getByRole("button", { name: "Close history" }).click();

  await page.getByRole("button", { name: "Reactivate", exact: true }).click();
  await expect(page.getByText("restores no former assignments")).toBeVisible();
  await page.getByLabel("Role name").fill("Dispatch Legacy");
  await page.getByRole("button", { name: "Create version and reactivate" }).click();
  expect(reactivateBody).toMatchObject({ displayName: "Dispatch Legacy", capabilityKeys: ["roles:read"], expectedVersion: 1 });
  await expect(page.getByRole("heading", { name: "Dispatch Legacy" })).toHaveCount(0);
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
  await page.route("**/api/admin/context", (route) => route.fulfill({ status: 401, json: { code: "admin.http401" } }));
  await signInAsCombinedOwner(page);
  await page.getByRole("button", { name: "Admin" }).click();
  await expect(page.locator(".admin-error")).toHaveText("Administration: sign in again.");
  await expect(page.getByRole("heading", { name: "Active configuration" })).toHaveCount(0);
});

test("owner edits and previews the unsaved form through Stationary without creating a clinical record", async ({ page }) => {
  const definition = { schemaVersion: 1, sections: [
    { key: "patient", name: "Patient preview", fields: [
      { key: "last-name", source: { kind: "nemsis", elementId: "ePatient.02" }, required: true },
      { key: "age", source: { kind: "nemsis", elementId: "ePatient.15" } }
    ] },
    { key: "assessment", fields: [{ key: "impression", source: { kind: "nemsis", elementId: "eSituation.11" } }] }
  ] };
  const draft = { id: "draft-id", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "version-id",
    revision: 4, definitionSha256: "a".repeat(64), definition, diagnostics: [], updatedAt: new Date().toISOString() };
  let savedDefinition = definition;
  await page.route("**/api/admin/form-versions", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/validation-versions", (route) => route.fulfill({ json: [{ id: "validation-id", displayName: "Rules", catalogReleaseId: "catalog-id", version: 1, status: "active" }] }));
  await page.route("**/api/admin/form-drafts/draft-id", (route) => {
    const body = route.request().postDataJSON();
    savedDefinition = body.definition;
    return route.fulfill({ json: { ...draft, definition: savedDefinition, displayName: body.displayName, revision: 5 } });
  });
  await page.route("**/api/admin/form-drafts/draft-id/publish", (route) => route.fulfill({ json: {
    id: "published-id", formId: "form-id", catalogReleaseId: "catalog-id", displayName: "Arranged form", version: 4,
    status: "published", structuralSummary: { sections: 2, fields: 3, rules: 0 }, definitionSha256: "a".repeat(64), publishedAt: new Date().toISOString()
  } }));
  await page.route("**/api/admin/form-versions/published-id/activate", (route) => route.fulfill({ json: {
    organizationId: "organization-id", formVersionId: "published-id", formId: "form-id", catalogReleaseId: "catalog-id", activatedAt: new Date().toISOString()
  } }));
  const clinicalMutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/(reports|calls\/[^/]+\/open)/.test(request.url())) clinicalMutations.push(request.url());
  });
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    owner: { id: "owner-id", displayName: "Installation Owner" }, organization: { id: "organization-id", name: "Example EMS" },
    panels: ["dashboard", "catalog", "forms"],
    capabilities: ["catalog:read", "catalog:write", "catalog:publish", "forms:read", "forms:write", "forms:publish", "validation:publish"],
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
  await page.getByRole("button", { name: "Form editor", exact: true }).click();

  const editor = page.locator(".form-editor");
  await editor.getByLabel("Find by identifier, name, or description").fill("patient");
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

  await editor.getByLabel("New section name").fill("Care");
  await editor.getByRole("button", { name: "Create section", exact: true }).click();
  await editor.getByLabel("Section name", { exact: true }).fill("Care given");
  await editor.getByLabel("Go to section").selectOption("patient");
  await editor.getByLabel("Move to section ePatient.01").selectOption({ label: "Care given" });
  await expect(editor.getByText("Unsaved changes. Field moved. Data binding preserved.", { exact: true })).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview form" }).click();
  const preview = await popupPromise;

  await expect(preview.getByRole("heading", { name: "Draft form" })).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole("navigation", { name: "Stationary record sections" }).getByText("Patient preview", { exact: true })).toBeVisible();
  await expect(preview.locator('[data-element-id="ePatient.02"]').first()).toBeVisible();
  await preview.getByRole("navigation", { name: "Stationary record sections" }).getByText("Care given", { exact: true }).click();
  await expect(preview.locator('[data-element-id="ePatient.01"]').first()).toBeVisible();
  await preview.locator('[data-element-id="ePatient.02"] input').first().fill("Preview surname");
  await preview.getByRole("button", { name: "Return to form draft" }).click();
  await expect.poll(() => preview.isClosed()).toBe(true);

  await expect(page.getByRole("button", { name: "Preview form" })).toBeVisible();
  await expect(page.getByText("Opened Form preview in a new window.")).toBeVisible();
  await expect(page.locator(".form-fields").getByText("ePatient.02", { exact: true })).toBeVisible();
  await editor.getByLabel("Form version display name").fill("Arranged form");
  await editor.getByRole("button", { name: "Save form draft" }).click();
  await expect(editor.getByText("All changes saved", { exact: true })).toBeVisible();
  expect(savedDefinition.sections.at(-1)).toMatchObject({ name: "Care given", fields: [{ source: { kind: "nemsis", elementId: "ePatient.01" } }] });
  await editor.getByLabel("Publication note", { exact: true }).fill("Arrange care section");
  await editor.getByRole("button", { name: "Publish immutable form" }).click();
  await expect(page.getByRole("heading", { name: "Published Arranged form" })).toBeVisible();
  await page.getByLabel("Activation note", { exact: true }).fill("Deploy arranged form");
  await page.getByRole("button", { name: "Activate as agency default", exact: true }).click();
  await expect(page.getByRole("button", { name: "Agency default active", exact: true })).toBeDisabled();
  expect(clinicalMutations).toEqual([]);
});

test("Swedish agency administration keeps authored names and role permissions", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed public configuration.");
  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: {
    csrfToken: "synthetic-browser-session", user: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" },
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    capabilities: ["admin-dashboard:read", "users:read"]
  } }));
  await page.route("**/api/calls/assigned", assignedCalls);
  await page.route("**/api/installation", (route) => route.fulfill({
    json: { settings: { ...productionSettings, language: "sv" } }
  }));
  await page.route("**/api/admin/context", (route) => route.fulfill({ json: {
    owner: { id: "owner-id", displayName: "Installation Owner" },
    organization: { id: "organization-id", name: "Example EMS" },
    panels: ["dashboard", "users"], capabilities: ["admin-dashboard:read", "users:read"],
    activeConfiguration: { catalog: { id: "catalog-id", name: "Agency Catalog", version: "4" },
      stationaryForm: { id: "form-id", formId: "form-id", name: "Agency Stationary", version: 3 } }, dashboard
  } }));
  await page.route("**/api/admin/users**", (route) => route.fulfill({ json: {
    items: [{ id: "user-id", displayName: "Anna Medic", username: "anna.medic", active: true, owner: false,
      roles: [{ id: "role-id", displayName: "Clinical Lead", active: true, protected: false }] }],
    nextCursor: null, pageSize: 50
  } }));
  await page.route("**/api/admin/users/role-options", (route) => route.fulfill({ json: { items: [] } }));
  await signInAsCombinedOwner(page, ["admin-dashboard:read", "users:read"]);
  await page.getByRole("group", { name: "Dokumentationsvy" }).getByRole("button", { name: "Administration" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.getByRole("heading", { name: "Aktiv konfiguration" })).toBeVisible();
  await expect(page.getByText("Agency Catalog", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administrationspaneler" })).toBeVisible();
  await page.getByRole("button", { name: "Användare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Användare" })).toBeVisible();
  await expect(page.getByRole("search", { name: "Sök användare" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Anna Medic/ })).toContainText("Clinical Lead");
  await expect(page.getByRole("button", { name: "Skapa användare" })).toHaveCount(0);
});
