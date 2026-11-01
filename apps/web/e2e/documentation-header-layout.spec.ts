import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 350 }, { width: 1440, height: 900 }, { width: 1024, height: 700 }, { width: 390, height: 844 }]) {
  test(`documentation clears the top bars at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true", "Uses the local demo session.");
    // Keep background API requests local; unavailable protected storage exposes
    // the real record notice that must not overlap the sticky patient header.
    await page.route("**/api/**", route => route.fulfill({ status: 503, json: {} }));
    await page.goto("/");
    await page.getByLabel("Username").fill("demo");
    await page.getByLabel("Password").fill("opentriagedemo");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Stationary", exact: true }).click();
    await page.getByRole("button", { name: "Open call", exact: true }).click();
    await expect(page.locator(".encounter-header")).toBeVisible();
    await expect(page.locator(".app-shell > .safety-notice")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 300));
    const bar = await page.locator(".session-bar").boundingBox();
    const header = await page.locator(".encounter-header").boundingBox();
    expect(header!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
    // Visibility alone does not catch a banner painted over the header.
    await expect.poll(() => page.locator(".encounter-header").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return [0.1, 0.5, 0.9].every(fraction =>
        element.contains(document.elementFromPoint(rect.x + rect.width * fraction, rect.y + 2)));
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("documentation-header.png") });
  });
}
