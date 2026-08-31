import { expect, test } from "@playwright/test";

test("static deployment preserves the complete browser-only journey", async ({ page, request }) => {
  await expect.poll(async () => (await request.get("./")).status(), { timeout: 60_000 }).toBe(200);

  await page.goto("./");
  const deploymentOrigin = new URL(page.url()).origin;
  const unexpectedRequests: string[] = [];
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (url.origin !== deploymentOrigin && url.protocol !== "data:") unexpectedRequests.push(outgoing.url());
  });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  const safetyNotice = page.getByRole("note", { name: "Prototype safety notice" });
  await expect(safetyNotice).toContainText("Synthetic data only");
  await expect(safetyNotice).toContainText("not for clinical use");
  await expect(page.getByText("Prototype", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toContain("/open-triage-epcr-demo/");

  await page.getByRole("button", { name: "Add medication" }).click();
  await page.getByRole("searchbox", { name: /Medication/ }).fill("morphine");
  await expect(page.getByRole("button", { name: /Morphine/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close medication editor" }).click();

  await page.getByRole("button", { name: "Add procedure" }).click();
  await page.getByRole("searchbox", { name: /Search all/ }).fill("12 lead");
  await expect(page.getByRole("button", { name: /ECG, 12 lead/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close procedure editor" }).click();

  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Static deployment autosave check");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.getByText("Static deployment autosave check")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Static deployment autosave check")).toBeVisible();
  await expect(safetyNotice).toContainText("not for clinical use");

  await page.getByRole("button", { name: /Review encounter, 3 required items left/ }).click();
  await page.getByRole("button", { name: /Acuity upon EMS release/ }).click();
  await page.getByLabel("Acuity upon EMS release").selectOption("4219003");
  await page.getByLabel("Unit disposition").selectOption("4227001");
  await page.getByLabel("Clinical narrative review").fill("Inferior STEMI treated on scene; pain improved before handover.");
  await page.getByRole("button", { name: /Review encounter, 0 required items left/ }).click();
  for (const acknowledgement of await page.locator(".review-acknowledgement input").all()) await acknowledgement.check();
  await page.getByRole("button", { name: "Finish prototype" }).click();
  await expect(page.getByRole("heading", { name: "Encounter summary" })).toBeVisible();
  await expect(safetyNotice).toContainText("Synthetic data only");

  await page.getByRole("button", { name: "Continue editing" }).click();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset prototype data" }).click();
  await expect(page.getByText("Static deployment autosave check")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Review encounter, 3 required items left/ })).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
});
