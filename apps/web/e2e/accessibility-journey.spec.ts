import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

  for (const control of await page.locator(".view-switcher button, .sign-action-bar button, .quick-actions button, .reset-prototype").all()) {
    const box = await control.boundingBox();
    expect(box, `missing control bounds for ${await control.getAttribute("aria-label") ?? await control.textContent()}`).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("canonical incident header and timing entries render in the phone flow", async ({ page }) => {
  await expect(page.locator(".encounter-header")).toContainText("Incident SYN-2026-0418-113 · 3-9-7-4-0");
  await expect(page.locator(".encounter-header")).toContainText("Medical assistance requested");
  await expect(page.getByLabel("Crew AN")).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("Unit Arrived on Scene", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("Unit En Route", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("eTimes.06", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-list").getByText("eTimes.05", { exact: true })).toBeVisible();
});

test("quick capture phone journey remains operable and persists", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  expect(await page.locator(".quick-actions button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([
    "Add vital signs", "Add medication", "Add procedure", "Add clinical note", "Edit patient information",
  ]);
  await expectPhoneLayout(page);
  await expectNoBlockingAccessibilityViolations(page);

  await page.getByRole("button", { name: /Checklist, 0 errors, 0 warnings/ }).click();
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expect(page.getByText("No warnings or errors")).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page);
  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByRole("heading", { name: "Review and finish" })).toBeVisible();
  await page.getByRole("button", { name: "Finish prototype" }).click();
  await expect(page.getByRole("heading", { name: "Encounter summary" })).toBeVisible();
  await page.getByRole("button", { name: "Continue editing" }).click();
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
  await expect(page.getByText("Accessible phone journey note")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset prototype data" }).click();
  await expect(page.getByText("Accessible phone journey note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Checklist, 0 errors, 0 warnings/ })).toBeVisible();
});

test("dialog focus, touch targets, and enlarged text preserve required actions", async ({ page }) => {
  const addVitals = page.getByRole("button", { name: "Add vital signs" });
  await addVitals.click();
  await expect(page.getByRole("dialog", { name: "Vital signs" }).getByLabel(/Clinical time/)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(addVitals).toBeFocused();

  await page.addStyleTag({ content: `
    .safety-notice, .encounter-header, .view-switcher, .section-heading, .timeline-list, .quick-actions,
    .note-dialog, .review-panel, .prototype-summary { font-size: 125% !important; }
  ` });
  await expectPhoneLayout(page);
  await expect(page.getByRole("button", { name: "Add clinical note" })).toBeVisible();
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await expect(page.getByRole("button", { name: "Add to timeline" })).toBeVisible();
});

test("vital fields retain focus while values are entered", async ({ page }) => {
  await page.getByRole("button", { name: "Add vital signs" }).click();
  const systolic = page.getByRole("dialog", { name: "Vital signs" }).getByRole("textbox", { name: /Systolic BP/ });

  await systolic.fill("120");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  await expect(systolic).toBeFocused();
  await expect(systolic).toHaveValue("120");
});
