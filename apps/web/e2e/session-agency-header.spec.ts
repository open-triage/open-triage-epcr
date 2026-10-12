import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("owner agency selector keeps the session bar aligned without a visible label", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const session = {
    csrfToken: "header-test", installationOwner: true,
    user: { id: "40000000-0000-4000-8000-000000000001", displayName: "Installation Owner" },
    organization: { id: "40000000-0000-4000-8000-000000000002", name: "Demonstration EMS" },
    agencies: [
      { id: "40000000-0000-4000-8000-000000000002", name: "Demonstration EMS" },
      { id: "40000000-0000-4000-8000-000000000003", name: "Another agency with a long display name" },
    ],
    startedAt: "2026-10-12T08:00:00Z", expiresAt: "2099-10-12T20:00:00Z",
    capabilities: ["clinical:document", "users:read", "review:read"], workspaceAvailable: true,
  };
  await page.addInitScript(stored => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/calls/assigned") return route.fulfill({ json: { assignedCalls: [], canceledAssignmentIds: [] } });
    if (path === "/api/reports/open") return route.fulfill({ json: { openCalls: [], completedReportIds: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  const header = page.locator(".session-bar");
  await expect(header.getByRole("combobox", { name: "Agency", exact: true })).toBeVisible();
  await expect(header.getByText("Agency", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => header.evaluate(element => {
      const items = [...element.children].map(child => child.getBoundingClientRect());
      const logout = items.at(-1)!;
      const bounds = element.getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth && logout.right <= bounds.right &&
        items.every((a, i) => items.slice(i + 1).every(b =>
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    }), { message: `Session controls must not overlap or overflow at ${width}px` }).toBe(true);
    if (width >= 1024) {
      const logout = await header.getByRole("button", { name: "Log out" }).boundingBox();
      const selector = await header.getByRole("combobox", { name: "Agency" }).boundingBox();
      expect(Math.abs(logout!.y - selector!.y)).toBeLessThan(2);
    }
  }
});
