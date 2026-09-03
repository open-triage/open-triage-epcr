import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const assignmentId = "32000000-0000-4000-8000-000000000011";
const reportId = "42000000-0000-4000-8000-000000000013";

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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

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
    body: JSON.stringify({
      assignmentId,
      report: {
        id: reportId,
        documentingUserId: "32000000-0000-4000-8000-000000000003",
        formVersionId: "32000000-0000-4000-8000-000000000008",
        catalogReleaseId: "42000000-0000-4000-8000-000000000014",
        revision: 0,
        status: "draft",
      },
      replacementAssignment: null,
    }),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByLabel("Username")).toHaveValue("demo.clinician");
  await expect(page.getByLabel("Password")).toHaveValue("open-triage-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
});

test("demo sign in is explicit and manual logout immediately hides clinical content", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in for your shift" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Sign in for your shift" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("shift session expired");
});

test("the opened call's incident header and dispatch event render in the phone flow", async ({ page }) => {
  await openCall(page);
  await expect(page.locator(".encounter-header")).toContainText("Incident SYN-20260903-001");
  await expect(page.locator(".encounter-header")).toContainText("Medical assistance requested");
  await expect(page.locator(".encounter-header")).not.toContainText("SYN-20260418-113 · 3-9-7-4-0");
  await expect(page.locator(".encounter-header")).not.toContainText("Rivera, Jordan");
  await expect(page.locator(".timeline-list").getByText("Unit Notified by Dispatch", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("eTimes.03", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("Unit Arrived on Scene", { exact: true })).toHaveCount(0);
  await expect(page.locator(".timeline-list").getByText("Unit En Route", { exact: true })).toHaveCount(0);
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
  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByRole("heading", { name: "Review and sign" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign record" })).toBeDisabled();
  await page.getByLabel("I reviewed and acknowledge this warning").check();
  await expect(page.getByRole("button", { name: "Sign record" })).toBeEnabled();
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
  await page.getByRole("region", { name: "Open calls" }).getByRole("button", { name: "Reopen call" }).click();
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
    ["Add vital signs", "Close vital signs editor"],
    ["Add medication", "Close medication editor"],
    ["Add procedure", "Close procedure editor"],
    ["Add clinical note", "Close note editor"],
  ] as const;
  const sizes: string[] = [];
  for (const [openLabel, closeLabel] of dialogs) {
    await page.getByRole("button", { name: openLabel }).click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(box!.width);
    expect(box!.height / box!.width).toBeLessThanOrEqual(1.11);
    sizes.push(`${Math.round(box!.width)}x${Math.round(box!.height)}`);
    await page.getByRole("button", { name: closeLabel }).click();
  }
  expect(new Set(sizes).size).toBe(1);
});

test("review and sign actions stay at the viewport bottom and turn green when validation is clear", async ({ page }) => {
  await openCall(page);
  await page.getByRole("button", { name: "Add vital signs" }).click();
  const dialog = page.getByRole("dialog", { name: "Vital signs" });
  const values = [
    [/Systolic BP/, "120"],
    [/Diastolic BP/, "80"],
    [/Heart rate/, "70"],
    [/SpO₂/, "98"],
    [/Respiratory rate/, "16"],
    [/GCS total/, "15"],
    [/Pain score/, "0"],
  ] as const;
  for (const [label, value] of values) await dialog.getByRole("textbox", { name: label }).fill(value);
  await dialog.getByRole("button", { name: "Add vital set" }).click();

  const reviewButton = page.getByRole("button", { name: "Review & sign" });
  await expect(reviewButton).toHaveClass(/validation-clear/);
  expect(await reviewButton.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgb(0, 120, 58)");
  const reviewBar = await page.locator(".sign-action-bar").boundingBox();
  expect(Math.abs((reviewBar!.y + reviewBar!.height) - page.viewportSize()!.height)).toBeLessThanOrEqual(1);

  await reviewButton.click();
  const signButton = page.getByRole("button", { name: "Sign record" });
  await expect(signButton).toHaveClass(/validation-clear/);
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
