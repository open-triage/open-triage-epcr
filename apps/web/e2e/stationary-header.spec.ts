import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";
import calls from "../public/demo-assigned-calls.json";
import opened from "../public/demo-open-assignment.json";

test("Stationary record information and actions stay separate as the viewport narrows", async ({ page }, testInfo) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const session = { csrfToken: "header-test", user: { id: opened.report.documentingUserId, displayName: "Header Test Clinician" },
    organization: { id: "32000000-0000-4000-8000-000000000001", name: "Synthetic EMS" },
    startedAt: "2026-09-28T08:00:00Z", expiresAt: "2099-09-28T20:00:00Z",
    capabilities: ["clinical:document"], workspaceAvailable: true };
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/calls/assigned") return route.fulfill({ json: calls });
    if (path === "/api/reports/open") return route.fulfill({ json: { openCalls: [], completedReportIds: [] } });
    if (path.endsWith("/open")) return route.fulfill({ json: opened });
    if (path.endsWith("/active")) return route.fulfill({ status: 304 });
    if (path.endsWith("/protected-key-envelope")) return route.fulfill({ status: 201, json: {
      schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle,
      recoveryDeadline: "2099-09-29T12:00:00Z", wrappingKeyVersion: 1,
    } });
    if (path.endsWith("/protected-ciphertext-receipt")) return route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-09-29T12:00:00Z" } });
    if (path.endsWith("/protected-ciphertext-checkpoint")) return route.fulfill({ json: route.request().postDataJSON() });
    if (path.endsWith("/draft-changes")) return route.fulfill({ json: { id: opened.report.id, status: "draft", revision: route.request().postDataJSON().expectedRevision + 1 } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).first().click();
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await expect(page.locator(".encounter-summary")).toBeVisible();
  for (const width of [320, 360, 390, 620, 768, 1024, 1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".encounter-header")!;
      const summary = header.querySelector<HTMLElement>(".encounter-summary")!;
      const actions = header.querySelector<HTMLElement>(".draft-actions")!;
      const a = actions.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const noOverlap = [...summary.children].every((child) => {
        const r = child.getBoundingClientRect();
        return r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom;
      });
      return noOverlap && a.right <= h.right + 1 && header.scrollWidth <= header.clientWidth + 1;
    }), { message: `Header actions must not overlap record information at ${width}px` }).toBe(true);
    const timeline = page.locator(".timeline-toggle-action");
    if (await timeline.getAttribute("aria-expanded") !== "true") await timeline.click();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(async () => {
      const header = await page.locator(".encounter-header").boundingBox();
      const sidebar = await page.locator(".stationary-timeline-sidebar").boundingBox();
      return sidebar!.y - (header!.y + header!.height);
    }).toBeGreaterThanOrEqual(-1);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("stationary-header-390.png") });
  }
});
