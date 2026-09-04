import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignedCall = demoAssignedCalls.assignedCalls[0]!;
const reportId = demoOpenAssignment.report.id;

test("mobile capture reconciles into a complete stationary record that alone can sign", async ({ page, context }) => {
  let revision = demoOpenAssignment.report.revision;
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(demoOpenAssignment),
  }));
  await page.route(`**/api/reports/${reportId}/reopen`, (route) => route.abort("internetdisconnected"));
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as { expectedRevision: number };
    revision = Math.max(revision, command.expectedRevision) + 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: reportId, status: "draft", revision }) });
  });

  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "mobile");
  await expect(page.getByRole("button", { name: "Sign record" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Captured on the mobile presentation");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  await page.getByRole("button", { name: "Save & close" }).click();

  const presentation = page.getByRole("group", { name: "Documentation presentation" });
  await presentation.getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Reopen call" }).click();
  await expect(page.locator(".event-detail").getByText("Captured on the mobile presentation", { exact: true })).toBeVisible();

  const firstName = page.locator('[data-element-id="ePatient.03"] .stationary-value-picker');
  await expect(firstName).toHaveAttribute("data-value-state", "ordinary");
  await firstName.getByLabel("Exceptional value").selectOption({ label: "Refused" });
  await expect(firstName.locator(".stationary-value-picker-state strong")).toHaveText("Refused");
  await page.getByLabel(/^First Name ePatient\.03/).fill("STATIONARY");
  await expect(firstName).toHaveAttribute("data-value-state", "ordinary");
  const narrative = page.locator('[data-element-id="eNarrative.01"] .stationary-value-picker');
  await expect(narrative.locator("textarea")).toBeVisible();
  await narrative.getByLabel("Exceptional value").selectOption({ label: "Not Recorded" });
  await expect(narrative).toHaveAttribute("data-value-state", "exceptional");
  await narrative.locator("textarea").fill("Stationary narrative text");
  await expect(narrative).toHaveAttribute("data-value-state", "ordinary");
  const sex = page.locator('[data-element-id="ePatient.25"]').first();
  await sex.locator("select").nth(0).selectOption({ index: 1 });
  await sex.locator("select").nth(1).selectOption({ label: "Not Reporting" });
  await sex.locator("select").nth(1).selectOption({ label: "Unable to Complete" });
  const responder = page.locator('[data-group-id="eScene.ResponderGroup"]');
  await responder.getByRole("button", { name: "Add eScene.ResponderGroup" }).click();
  await page.getByRole("dialog", { name: "Add eScene.ResponderGroup" }).getByLabel(/Other EMS or Public Safety Agencies at Scene/).fill("Mutual Aid 7");
  await page.getByRole("dialog", { name: "Add eScene.ResponderGroup" }).getByRole("button", { name: "Add row" }).click();

  await context.setOffline(true);
  await page.getByLabel(/^Last Name ePatient\.02/).fill("OFFLINE");
  await expect(page.locator(".sync-status")).toHaveText("Pending sync", { timeout: 4_000 });
  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.locator(".review-findings").getByText("eNarrative.01", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign record" })).toBeDisabled();
  await expect(page.getByText("Signing is unavailable while offline. Reconnect and finish synchronization.")).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 5_000 });

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 5_000 });
  await page.getByRole("button", { name: "Populate" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Review and sign" })).toBeVisible();
  await expect(page.getByText("0 errors · 1 warnings")).toBeVisible();
  await page.getByLabel("I reviewed and acknowledge this warning").check();
  const audit = await new AxeBuilder({ page }).include(".review-panel").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  await page.getByRole("button", { name: "Sign record" }).click();

  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "was signed and removed from active calls" })).toBeFocused();
  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  const cache = await page.evaluate((id) => ({
    shell: localStorage.getItem(`open-triage:standard-encounter-v1:report:${id}`),
    offline: JSON.parse(localStorage.getItem("open-triage:offline-reports-v1") ?? "[]").some((item: { report: { id: string } }) => item.report.id === id),
  }), reportId);
  expect(cache).toEqual({ shell: null, offline: false });
});
