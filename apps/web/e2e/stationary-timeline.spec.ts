import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignedCall = demoAssignedCalls.assignedCalls[0]!;

async function signIn(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

function assignedCalls(route: Route) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
  });
}

test("stationary timeline is remembered, filters events, restores focus, and edits and deletes draft notes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 800 });
  let revision = Number(demoOpenAssignment.report.revision);
  let note = {
    id: "10000000-0000-4000-8000-000000000093",
    reportId: demoOpenAssignment.report.id,
    type: "text" as const,
    content: "Stationary sidebar observation",
    capturedAt: "2026-09-24T18:35:00.000Z",
    capturedUtcOffsetMinutes: 120,
    author: { id: "30000000-0000-4000-8000-000000000001", displayName: "Demo Clinician" },
    serverReceivedAt: "2026-09-24T18:35:01.000Z",
    updatedAt: "2026-09-24T18:35:01.000Z",
    persistenceState: "ready" as const,
  };

  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...demoOpenAssignment, report: { ...demoOpenAssignment.report, notes: [note] } }),
  }));
  await page.route("**/demo-open-assignment.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...demoOpenAssignment, report: { ...demoOpenAssignment.report, notes: [note] } }),
  }));
  await page.route(/\/api\/reports\/[^/]+\/notes\/[^/]+$/, async (route) => {
    revision += 1;
    if (route.request().method() === "DELETE") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        reportId: note.reportId, noteId: note.id, revision, deleted: true,
      }) });
      return;
    }
    const command = route.request().postDataJSON() as { content: string };
    note = { ...note, content: command.content, updatedAt: new Date().toISOString() };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ reportId: note.reportId, revision, note }) });
  });

  await signIn(page);
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const toggle = page.getByRole("button", { name: /Timeline/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("complementary", { name: "Encounter timeline" })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const sidebar = page.getByRole("complementary", { name: "Encounter timeline" });
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBeGreaterThanOrEqual(350);
  expect((await sidebar.boundingBox())!.width).toBeLessThanOrEqual(370);
  const panel = (await page.locator(".app-shell").boundingBox())!;
  const sidebarBox = (await sidebar.boundingBox())!;
  const encounterHeader = (await page.locator(".encounter-header").boundingBox())!;
  expect(Math.abs(panel.x + panel.width - (sidebarBox.x + sidebarBox.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(panel.x + panel.width - (encounterHeader.x + encounterHeader.width))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => [...Object.entries(localStorage)].some(([key, value]) =>
    key.startsWith("open-triage:stationary-timeline-v1:user:") && value === "open"))).toBe(true);

  const filters = sidebar.getByRole("group", { name: "Filter timeline" });
  await filters.getByRole("button", { name: "Notes" }).click();
  await expect(filters.getByRole("button", { name: "Notes" })).toHaveAttribute("aria-pressed", "true");
  await expect(sidebar.getByText("Stationary sidebar observation")).toBeVisible();
  await expect(sidebar.getByText("Unit Notified by Dispatch", { exact: true })).toHaveCount(0);
  await filters.getByRole("button", { name: "All" }).click();
  await expect(sidebar.getByText("Unit Notified by Dispatch", { exact: true })).toBeVisible();

  let noteButton = sidebar.getByRole("button", { name: /Open text note.*Stationary sidebar observation/ });
  await noteButton.click();
  await expect(page.getByLabel("Note text")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(noteButton).toBeFocused();
  await noteButton.click();
  await page.getByLabel("Note text").fill("Stationary sidebar observation updated");
  await page.getByRole("button", { name: "Save changes" }).click();
  noteButton = sidebar.getByRole("button", { name: /Open text note.*updated/ });
  await expect(noteButton).toBeVisible();
  await noteButton.click();
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(sidebar.getByText("Stationary sidebar observation updated")).toHaveCount(0);
  await expect(toggle).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowSidebar = (await sidebar.boundingBox())!;
  expect(narrowSidebar.width).toBeLessThanOrEqual(390);
  expect(narrowSidebar.x).toBeGreaterThanOrEqual(0);
  expect(narrowSidebar.x + narrowSidebar.width).toBeLessThanOrEqual(390);

  const accessibility = await new AxeBuilder({ page }).include(".encounter-header, .stationary-timeline-sidebar")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);

  await filters.getByRole("button", { name: "All" }).focus();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
