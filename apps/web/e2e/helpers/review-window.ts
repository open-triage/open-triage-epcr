import { expect, type Locator, type Page } from "@playwright/test";

export async function openReviewCall(page: Page, row: Locator): Promise<Page> {
  await row.click();
  await expect(page.getByRole("article", { name: "Full report", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close full report", exact: true }).click();
  await page.locator("#review-inspector").waitFor();
  return page;
}

export async function refreshOnFocus(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

export async function closeReviewCall(page: Page): Promise<void> {
  await page.locator("#review-inspector").getByRole("button", { name: "Close report", exact: true }).click();
}
