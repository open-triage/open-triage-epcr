import { expect, test, type Page } from "@playwright/test";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

const session = {
  csrfToken: "feedback-csrf-token",
  user: { id: "40000000-0000-4000-8000-000000000001", displayName: "Feedback Clinician" },
  organization: { id: "40000000-0000-4000-8000-000000000002", name: "Feedback EMS" },
  startedAt: "2026-09-16T10:00:00.000Z",
  expiresAt: "2099-09-16T20:00:00.000Z",
  capabilities: ["clinical:document"],
  workspaceAvailable: true
};

async function openAuthenticatedMobile(page: Page) {
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: { assignedCalls: [], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() } }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: { reports: [] } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();
}

test("feedback cancel restores focus and failure preserves the selected draft", async ({ page }) => {
  await openAuthenticatedMobile(page);
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  let dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog.getByText("Do not include patient-identifying information.")).toBeVisible();
  await expect(dialog.getByLabel(/Choose Bug or Feature/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.route("**/api/feedback/v1/submissions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 503, json: { message: "unavailable" } });
  });
  await trigger.click();
  dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByRole("button", { name: "Bug" }).click();
  await expect(dialog.getByLabel("What happened, and what did you expect to happen?")).toBeVisible();
  const description = dialog.getByRole("textbox");
  await description.fill("The refresh control stopped responding");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("still here");
  await expect(description).toHaveValue("The refresh control stopped responding");
});

test("feature feedback submits the type-specific prompt and announces its opaque reference", async ({ page }) => {
  await openAuthenticatedMobile(page);
  let submitted: unknown;
  await page.route("**/api/feedback/v1/submissions", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { accepted: true, referenceCode: "J7M4Q2K8X5PN" } });
  });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByRole("button", { name: "Feature" }).click();
  await dialog.getByLabel("What would you like to do, and why would it help?").fill("Filter calls by unit");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Reference J7M4Q2K8X5PN" })).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(submitted).toMatchObject({ type: "feature", description: "Filter calls by unit" });
  expect((submitted as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

test("feedback remains first in each authenticated mode and is unavailable offline", async ({ page, context }) => {
  await openAuthenticatedMobile(page);
  const bar = page.locator(".session-bar");
  await expect(bar.locator("button").first()).toHaveAccessibleName("Send feedback");
  await page.getByRole("group", { name: "Documentation presentation" })
    .getByRole("button", { name: "Stationary" }).click();
  await expect(bar.locator("button").first()).toHaveAccessibleName("Send feedback");

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(bar.locator("button").first()).toBeDisabled();
  await expect(bar.locator("button").first()).toHaveAccessibleName("Send feedback unavailable while offline");
});
