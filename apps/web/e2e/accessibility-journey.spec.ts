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

  for (const control of await page.locator(".view-switcher button, .quick-actions button, .required-count, .reset-prototype").all()) {
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

test("complete phone journey remains operable and persists", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expectPhoneLayout(page);
  await expectNoBlockingAccessibilityViolations(page);

  await page.getByRole("button", { name: /Review encounter, 3 required items left/ }).click();
  await expect(page.getByRole("heading", { name: "Review and finish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish prototype" })).toBeDisabled();
  await expectNoBlockingAccessibilityViolations(page);

  await page.getByRole("button", { name: /Acuity upon EMS release/ }).click();
  const destination = page.getByLabel("Acuity upon EMS release");
  await expect(destination).toBeFocused();
  await destination.selectOption("4219003");
  await page.getByLabel("Unit disposition").selectOption("4227001");
  await page.getByLabel("Clinical narrative review").fill("Inferior STEMI treated on scene; pain improved before handover.");
  await expect(page.getByText("Status: required documentation complete")).toBeVisible();

  await page.getByRole("button", { name: /Review encounter, 0 required items left/ }).click();
  for (const acknowledgement of await page.locator(".review-acknowledgement input").all()) await acknowledgement.check();
  await expect(page.getByRole("button", { name: "Finish prototype" })).toBeEnabled();
  await page.getByRole("button", { name: "Finish prototype" }).click();
  await expect(page.getByRole("heading", { name: "Encounter summary" })).toBeVisible();
  await expect(page.getByText("Read-only preview — not a signed or complete legal clinical record")).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page);

  await page.getByRole("button", { name: "Continue editing" }).click();
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
  await expect(page.getByRole("button", { name: /Review encounter, 3 required items left/ })).toBeVisible();
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
