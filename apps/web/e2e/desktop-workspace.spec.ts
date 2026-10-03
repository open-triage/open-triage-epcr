import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("stationary, admin and review share a full-width desktop background", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API.");
  const now = new Date().toISOString();
  const session = { csrfToken: "desktop-test", user: { id: "workspace-user", displayName: "Workspace user" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: now, expiresAt: "2099-10-02T20:00:00Z",
    capabilities: ["clinical:document", "admin-dashboard:read", "review:all"], workspaceAvailable: true };
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/calls/assigned") return route.fulfill({ json: { assignedCalls: [], canceledAssignmentIds: [], refreshedAt: now } });
    if (path === "/api/reports/open") return route.fulfill({ json: { openCalls: [], completedReportIds: [] } });
    if (path === "/api/admin/context") return route.fulfill({ json: { organization: session.organization,
      panels: [], capabilities: session.capabilities, dashboard: null, activeConfiguration: null } });
    if (path === "/api/review/attention") return route.fulfill({ json: { dataset: "real", asOf: now, assignments: 0, responses: 0, reopened: 0 } });
    if (path === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1, pageSize: 25,
      total: 0, asOf: now, items: [] } });
    if (path === "/api/review/outcomes") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  let background: string | undefined;
  for (const width of [1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [mode, name] of [["stationary", "Stationary"], ["admin", "Admin"], ["review", "Review"]]) {
      await page.getByRole("group", { name: "Documentation presentation", exact: true }).getByRole("button", { name, exact: true }).click();
      const shell = page.locator(`.authenticated-shell.${mode}-shell`);
      await expect(shell).toHaveClass(/desktop-shell/);
      await expect.poll(() => shell.evaluate((element) => element.clientWidth)).toBe(width);
      const color = await shell.evaluate((element) => getComputedStyle(element).backgroundColor);
      background ??= color;
      expect(color).toBe(background);
      if (mode !== "stationary") {
        const main = shell.locator("main");
        await expect(main).toBeVisible();
        await expect.poll(() => main.evaluate((element) => element.clientWidth)).toBe(width);
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
