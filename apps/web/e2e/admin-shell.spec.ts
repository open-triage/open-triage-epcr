import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

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

async function signInAsCombinedOwner(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify({
      accessToken: "synthetic-browser-session",
      user: { id: "owner-id", displayName: "Installation Owner" },
      organization: { id: "organization-id", name: "Example EMS" },
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      capabilities: ["clinical:document", "installation:administer"]
    }));
    window.localStorage.removeItem("open-triage.presentation-mode.v1");
  });
  await page.reload();
}

test("combined owners start clinically and can enter the authorized Admin shell by keyboard", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      owner: { id: "owner-id", displayName: "Installation Owner" },
      organization: { id: "organization-id", name: "Example EMS" },
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
  await expect(page.getByText(/Signed in as .* for/)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Administration panels" })).toBeVisible();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.locator(".admin-placeholder")).toHaveText(/Unavailable in this release/);
  await expect(page.locator(".admin-placeholder").locator("button, input, select, textarea, a")).toHaveCount(0);
});

test("an open clinical report blocks entry into Admin until Save and close", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment)
  }));
  await signInAsCombinedOwner(page);

  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.getByRole("button", { name: "Admin" }).click();
  await expect(page.locator(".admin-entry-blocked")).toHaveText("Save and close the open report before entering Admin mode.");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "mobile");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
});

test("a forged browser capability cannot bypass direct Admin API authorization", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/api/admin/context", (route) => route.fulfill({ status: 401, body: "Unauthorized" }));
  await signInAsCombinedOwner(page);
  await page.getByRole("button", { name: "Admin" }).click();
  await expect(page.locator(".admin-error")).toHaveText("Your account is not authorized to administer this installation.");
  await expect(page.getByRole("heading", { name: "Active configuration" })).toHaveCount(0);
});

test("owner previews the unsaved form through Stationary without creating a clinical record", async ({ page }) => {
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
    activeConfiguration: { catalog: { id: "catalog-id", name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
      stationaryForm: { id: "version-id", formId: "form-id", name: "Agency Stationary", version: 3 } },
    dashboard,
  }) }));
  await page.route("**/api/admin/catalog-draft", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/api/admin/form-draft", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(draft) }));
  await page.route("**/api/admin/form-drafts/draft-id/catalog-elements**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextOffset: null }) }));
  await signInAsCombinedOwner(page);
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Stationary form", exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview Stationary form" }).click();
  const preview = await popupPromise;

  await expect(preview.getByRole("heading", { name: "Draft Stationary form" })).toBeVisible();
  await expect(preview.getByRole("navigation", { name: "Stationary record sections" }).getByText("Patient preview", { exact: true })).toBeVisible();
  await expect(preview.locator('[data-element-id="ePatient.02"]').first()).toBeVisible();
  await expect(preview.locator('[data-element-id="ePatient.01"]')).toHaveCount(0);
  await preview.locator('[data-element-id="ePatient.02"] input').first().fill("Preview surname");
  await preview.getByRole("button", { name: "Return to form draft" }).click();
  await expect.poll(() => preview.isClosed()).toBe(true);

  await expect(page.getByRole("button", { name: "Preview Stationary form" })).toBeVisible();
  await expect(page.getByText("Opened Stationary form preview in a new window.")).toBeVisible();
  await expect(page.locator(".form-fields").getByText("ePatient.02", { exact: true })).toBeVisible();
  expect(clinicalMutations).toEqual([]);
});
