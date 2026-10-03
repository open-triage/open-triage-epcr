import { expect, test } from "@playwright/test";
import production from "@open-triage/contracts/config/installation.production.json";
import { DEFAULT_AGENCY_APPEARANCE } from "@open-triage/contracts";

test.use({ locale: "sv-SE" });

const serverMode = process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true";
test.skip(!serverMode, "The API installation response is exercised in server mode.");

const session = {
  accessToken: "synthetic-browser-session", csrfToken: "csrf-proof",
  user: { id: "owner-id", displayName: "Installation Owner" },
  organization: { id: "organization-id", name: "Example EMS" },
  startedAt: "2026-09-28T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
  capabilities: ["admin-dashboard:read", "settings:read", "settings:write"], workspaceAvailable: true,
};
const demographics = { agencyUniqueStateId: "STATE-1", agencyNumber: "AGENCY-1", stateCode: "36",
  stateDisplay: "New York", stateCodeSystem: "ANSI-STATE", stateTerminologyVersion: null,
  versionId: "version-id", version: 2, catalogReleaseId: "catalog-id", effectiveFrom: "2026-09-24T10:00:00.000Z" };

test("agency language saves through settings and takes effect on the next workspace load", async ({ page }) => {
  let language: "en" | "sv" = "en";
  let revision = 4;
  let writes = 0;
  await page.route("**/api/installation", (route) => route.fulfill({ json: {
    settings: { ...production, language }, appearance: DEFAULT_AGENCY_APPEARANCE,
  } }));
  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: session }));
  await page.route("**/api/admin/context", (route) => route.fulfill({ json: {
    organization: session.organization, panels: ["settings"], capabilities: session.capabilities,
    activeConfiguration: null, dashboard: null,
  } }));
  await page.route("**/api/admin/agency-settings", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(route.request().headers()["x-csrf-token"]).toBe("csrf-proof");
      expect(body.expectedRevision).toBe(revision);
      expect(body.language).toBe("sv");
      language = body.language;
      revision += 1;
      writes += 1;
    }
    return route.fulfill({ json: {
      organizationId: session.organization.id, language, revision,
      reportMediaAllowanceBytes: 50 * 1024 * 1024, imageMediaLimitBytes: 10 * 1024 * 1024,
      defaultReportMediaAllowanceBytes: 50 * 1024 * 1024, defaultImageMediaLimitBytes: 10 * 1024 * 1024,
      storageGrowthWarning: false, updatedAt: "2026-09-28T10:00:00.000Z",
      appearance: DEFAULT_AGENCY_APPEARANCE, demographics,
    } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.evaluate((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agency Settings" })).toBeVisible();
  await page.getByLabel("Agency language").selectOption("sv");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Agency Settings saved");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Agency Settings" })).toBeVisible();
  expect(writes).toBe(1);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Myndighetsinställningar" })).toBeVisible();
  await expect(page.getByLabel("Myndighetens språk")).toHaveValue("sv");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("open-triage.clinician-session.v1")!).user.id)).toBe("owner-id");
  await page.evaluate(() => localStorage.removeItem("open-triage.clinician-session.v1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await expect(page.getByLabel("Användarnamn")).toBeVisible();
  await expect(page.getByLabel("Lösenord")).toBeVisible();
});
