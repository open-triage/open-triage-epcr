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

  const assignmentId = "32000000-0000-4000-8000-000000000011";
  const reportId = "42000000-0000-4000-8000-000000000013";
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

  await expect(page.getByLabel("Username")).toHaveValue("demo.clinician");
  await expect(page.getByLabel("Password")).toHaveValue("open-triage-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const safetyNotice = page.getByRole("note", { name: "Prototype safety notice" });
  await expect(safetyNotice).toContainText("Synthetic data only");
  await expect(safetyNotice).toContainText("not for clinical use");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toContain("/open-triage-epcr-demo/");

  await page.getByRole("button", { name: "Add medication" }).click();
  await page.getByRole("searchbox", { name: /Search medications/ }).fill("morphine");
  await expect(page.getByRole("button", { name: /Morphine/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();

  await page.getByRole("button", { name: "Add procedure" }).click();
  await page.getByRole("searchbox", { name: /Search procedures/ }).fill("12 lead");
  await expect(page.getByRole("button", { name: /ECG, 12 lead/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();

  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Static deployment autosave check");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.getByText("Static deployment autosave check")).toBeVisible();
  await page.reload();
  await page.getByRole("region", { name: "Open calls" }).getByRole("button", { name: "Reopen call" }).click();
  await expect(page.getByText("Static deployment autosave check")).toBeVisible();
  await expect(safetyNotice).toContainText("not for clinical use");

  await page.getByRole("button", { name: /Checklist, 0 errors, 1 warning/ }).click();
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expect(page.getByText("At least one set of vital signs should be documented.")).toBeVisible();
  await expect(safetyNotice).toContainText("Synthetic data only");

  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByRole("heading", { name: "Review and sign" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign record" })).toBeDisabled();
  await page.getByLabel("I reviewed and acknowledge this warning").check();
  await page.getByRole("button", { name: "Sign record" }).click();
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Open calls" }).getByText("SYN-20260903-001", { exact: true })).toHaveCount(0);
  expect(unexpectedRequests).toEqual([]);
});
