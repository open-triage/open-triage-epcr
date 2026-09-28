import { expect, test, type Page } from "@playwright/test";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

const serverBacked = process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true";
const session = {
  csrfToken: "startup-test-csrf",
  user: { id: "40000000-0000-4000-8000-000000000001", displayName: "Startup Clinician" },
  organization: { id: "40000000-0000-4000-8000-000000000002", name: "Startup EMS" },
  startedAt: "2026-09-28T10:00:00.000Z",
  expiresAt: "2099-09-28T20:00:00.000Z",
  capabilities: ["clinical:document"],
  workspaceAvailable: true,
};

async function prepare(page: Page) {
  await page.addInitScript((stored) => {
    localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored));
    // Observe every rendered state, including ones too brief for polling assertions.
    const states: string[] = [];
    Object.assign(window, { startupStates: states });
    new MutationObserver(() => states.push(document.body?.textContent ?? ""))
      .observe(document, { subtree: true, childList: true, characterData: true });
  }, session);
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: {
    assignedCalls: [], canceledAssignmentIds: [], refreshedAt: new Date().toISOString(),
  } }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: {
    openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString(),
  } }));
}

test("healthy restarted sessions never flash reconnect or sign-in screens", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await prepare(page);
  let releaseInstallation!: () => void;
  let releaseSession!: () => void;
  const installationPending = new Promise<void>((resolve) => { releaseInstallation = resolve; });
  const sessionPending = new Promise<void>((resolve) => { releaseSession = resolve; });
  let installationRequested = false;
  let sessionRequested = false;
  await page.route("**/api/installation", async (route) => {
    installationRequested = true;
    await installationPending;
    await route.fulfill({ json: { settings: productionSettings } });
  });
  await page.route("**/api/sessions/current", async (route) => {
    sessionRequested = true;
    await sessionPending;
    await route.fulfill({ json: session });
  });
  await page.goto("/");
  await expect.poll(() => installationRequested && sessionRequested).toBe(true);
  await expect(page.getByText("Opening OpenTriage…", { exact: true })).toBeVisible();
  await expect(page.locator(".authenticated-shell")).toHaveCount(0);
  releaseInstallation();
  await expect(page.locator(".authenticated-shell")).toHaveCount(0);
  releaseSession();
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  const states = await page.evaluate(() => (window as unknown as { startupStates: string[] }).startupStates);
  expect(states.some((text) => /Reconnect to continue|could not connect/.test(text))).toBe(false);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toHaveCount(0);
});

test("failed restart stays gated and recovers without flashing another loading screen", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await prepare(page);
  let available = false;
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/sessions/current", (route) => available
    ? route.fulfill({ json: session }) : route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(page.locator(".session-loading").getByRole("alert")).toContainText("could not connect");
  await expect(page.locator(".authenticated-shell")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(page.getByText("Reconnect to continue.", { exact: true })).toBeVisible();
  available = true;
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
});

test("an expired server session returns to sign-in without exposing stored identity", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await prepare(page);
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/sessions/current", (route) => route.fulfill({ status: 401 }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator(".authenticated-shell")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("open-triage.clinician-session.v1"))).toBeNull();
  const states = await page.evaluate(() => (window as unknown as { startupStates: string[] }).startupStates);
  expect(states.some((text) => text.includes("Startup Clinician") || text.includes("Reconnect to continue"))).toBe(false);
});
