import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignedCall = demoAssignedCalls.assignedCalls[0] as AssignedCall;

function assignedCalls(route: Route) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
  });
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("explicit workflow mode survives reload and viewport changes without changing visible calls", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await signIn(page);

  const selector = page.getByRole("group", { name: "Documentation presentation" });
  const mobile = selector.getByRole("button", { name: "Mobile" });
  const stationary = selector.getByRole("button", { name: "Stationary" });
  const visibleCall = page.getByText(assignedCall.callNumber, { exact: true });

  await expect(mobile).toHaveAttribute("aria-pressed", "true");
  await stationary.click();
  await expect(stationary).toHaveAttribute("aria-pressed", "true");

  for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(stationary).toHaveAttribute("aria-pressed", "true");
    await expect(visibleCall).toBeVisible();
  }

  await page.reload();
  await expect(stationary).toHaveAttribute("aria-pressed", "true");
  await expect(visibleCall).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(stationary).toHaveAttribute("aria-pressed", "true");
});

test("mobile reports retain Save and close without review or signing actions", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));
  await signIn(page);

  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "mobile");
  await expect(page.getByRole("button", { name: "Save & close" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review & sign" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign record" })).toHaveCount(0);

  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "stationary");
  await expect(page.getByRole("button", { name: "Review & sign" })).toBeVisible();
});
