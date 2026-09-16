import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import { incidentSummary } from "../app/incident-document";
import type { EncounterDocument } from "@open-triage/contracts";

const assignmentId = demoAssignedCalls.assignedCalls[0]!.id;
const summary = incidentSummary(demoOpenAssignment.report.document as EncounterDocument);

async function openCall(page: Page) {
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
}

async function expectNoBlockingAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
}

async function expectPhoneLayout(page: Page) {
  const overflow = await page.evaluate(() => ({
    amount: document.documentElement.scrollWidth - window.innerWidth,
    elements: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
      .slice(0, 8),
  }));
  expect(overflow.amount, `overflowing elements: ${overflow.elements.join(", ")}`).toBeLessThanOrEqual(0);

  for (const control of await page.locator(".view-switcher button, .sign-action-bar button, .quick-actions button").all()) {
    const box = await control.boundingBox();
    expect(box, `missing control bounds for ${await control.getAttribute("aria-label") ?? await control.textContent()}`).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
}

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/calls/${assignmentId}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByLabel("Username")).toHaveValue("");
  await expect(page.getByLabel("Password")).toHaveValue("");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
});

test("demo sign in is explicit and manual logout immediately hides clinical content", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("You have logged out.");
});

test("the browser hides clinical content at the fixed session deadline", async ({ page }) => {
  await page.evaluate(() => {
    const key = "open-triage.clinician-session.v1";
    const session = JSON.parse(window.localStorage.getItem(key)!);
    session.expiresAt = new Date(Date.now() + 2_000).toISOString();
    window.localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("shift session expired");
});

test("the opened call's incident header and dispatch event render in the phone flow", async ({ page }) => {
  await openCall(page);
  await expect(page.locator(".encounter-header")).toContainText(`Incident ${summary.incidentNumber}`);
  await expect(page.locator(".encounter-header")).toContainText(`Response ${summary.responseNumber}`);
  await expect(page.locator(".encounter-header")).toContainText(`Unit ${summary.callSign}`);
  await expect(page.locator(".encounter-header")).toContainText(summary.location);
  await expect(page.locator(".encounter-header")).not.toContainText(demoAssignedCalls.assignedCalls[0]!.dispatchReason);
  await expect(page.getByRole("button", { name: "Add patient information" })).toHaveCount(0);
  await expect(page.locator(".timeline-list").getByText("Unit Notified by Dispatch", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("eTimes.03", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("Dispatch Notified", { exact: true })).toBeVisible();
});

test("quick capture phone journey remains operable and persists", async ({ page }) => {
  await openCall(page);
  expect(await page.locator(".quick-actions button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([
    "Add vital signs", "Add medication", "Add procedure", "Add clinical note",
  ]);
  expect(await page.locator(".quick-actions button span").allTextContents()).toEqual(["Vitals", "Medications", "Procedures", "Notes"]);
  await expectPhoneLayout(page);
  await expectNoBlockingAccessibilityViolations(page);

  await page.getByRole("button", { name: /Checklist, 0 errors, 1 warning/ }).click();
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expect(page.getByText("At least one set of vital signs should be documented.")).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page);
  await expect(page.getByRole("button", { name: "Review & sign" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign record" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue editing" })).toHaveCount(0);
  await page.getByRole("button", { name: /Timeline/ }).click();
  const addNote = page.getByRole("button", { name: "Add clinical note" });
  await addNote.click();
  const note = page.getByLabel("Note summary");
  await expect(note).toBeFocused();
  await expectNoBlockingAccessibilityViolations(page);
  await note.fill("Accessible phone journey note");
  const saveNote = page.getByRole("button", { name: "Add to timeline" });
  await saveNote.scrollIntoViewIfNeeded();
  const saveBox = await saveNote.boundingBox();
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await saveNote.click();
  await expect(page.getByText("Accessible phone journey note")).toBeVisible();

  await page.reload();
  await page.getByRole("region", { name: "Open reports" }).getByRole("button", { name: "Reopen report" }).click();
  await expect(page.getByText("Accessible phone journey note")).toBeVisible();
});

test("dialog focus, touch targets, and enlarged text preserve required actions", async ({ page }) => {
  await openCall(page);
  const addVitals = page.getByRole("button", { name: "Add vital signs" });
  await addVitals.click();
  await expect(page.getByRole("dialog", { name: "Vital signs" }).getByLabel(/Clinical time/)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(addVitals).toBeFocused();

  await page.addStyleTag({ content: `
    .safety-notice, .encounter-header, .view-switcher, .section-heading, .timeline-list, .quick-actions,
    .note-dialog, .review-panel { font-size: 125% !important; }
  ` });
  await expectPhoneLayout(page);
  await expect(page.getByRole("button", { name: "Add clinical note" })).toBeVisible();
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await expect(page.getByRole("button", { name: "Add to timeline" })).toBeVisible();
});

test("all four documentation dialogs share a slightly portrait, near-square size", async ({ page }) => {
  await openCall(page);
  const dialogs = [
    "Add vital signs",
    "Add medication",
    "Add procedure",
    "Add clinical note",
  ] as const;
  const sizes: string[] = [];
  for (const openLabel of dialogs) {
    await page.getByRole("button", { name: openLabel }).click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(box!.width);
    expect(box!.height / box!.width).toBeLessThanOrEqual(1.11);
    sizes.push(`${Math.round(box!.width)}x${Math.round(box!.height)}`);
    await page.getByRole("button", { name: "Remove" }).click();
  }
  expect(new Set(sizes).size).toBe(1);
});

test("stationary review keeps the signing action fixed after population", async ({ page }) => {
  await page.getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".stationary-record-layout")).toBeVisible();
  await page.getByRole("button", { name: "Populate" }).click();

  const reviewButton = page.getByRole("button", { name: "Review & sign" });
  await expect(reviewButton).toBeVisible();
  await reviewButton.click();
  const signButton = page.getByRole("button", { name: "Sign record" });
  await expect(signButton).toBeVisible();
  const signBar = await page.locator(".review-actions").boundingBox();
  expect(Math.abs((signBar!.y + signBar!.height) - page.viewportSize()!.height)).toBeLessThanOrEqual(1);
});

test("vital fields retain focus while values are entered", async ({ page }) => {
  await openCall(page);
  await page.getByRole("button", { name: "Add vital signs" }).click();
  const systolic = page.getByRole("dialog", { name: "Vital signs" }).getByRole("textbox", { name: /Systolic BP/ });

  await systolic.fill("120");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  await expect(systolic).toBeFocused();
  await expect(systolic).toHaveValue("120");
});
