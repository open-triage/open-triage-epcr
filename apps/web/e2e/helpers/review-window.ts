import type { Locator, Page } from "@playwright/test";

export async function openReviewCall(page: Page, row: Locator): Promise<Page> {
  const pending = page.context().waitForEvent("page");
  await row.click();
  const call = await pending;
  await call.waitForLoadState();
  return call;
}

export async function refreshOnFocus(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
