import { expect, test as base, type Page } from "@playwright/test";
import fixture from "../../../packages/contracts/src/synthetic-demo-fixture.json";

function apiResponse(page: Page, path: string, method: string) {
  return page.waitForResponse(response => response.url() === new URL(path, page.url()).href &&
    response.request().method() === method);
}

const test = base.extend<{ demoSession: { csrfToken: string } }>({
  demoSession: [async ({ page, baseURL }, runWithSession) => {
    await page.goto("/");
    expect(new URL(page.url()).origin).toBe(baseURL);
    await page.getByLabel("Username", { exact: true }).fill(fixture.username);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    const [login] = await Promise.all([
      apiResponse(page, "/api/sessions", "POST"),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    expect(login.status()).toBe(201);
    const session = await login.json();
    try {
      expect(session.user.id).toBe(fixture.userId);
      await expect(page.getByRole("region", { name: "Open reports" })).toBeVisible();
      expect(typeof session.csrfToken).toBe("string");
      await runWithSession(session);
    } finally {
      await page.getByRole("button", { name: "Log out", exact: true }).click();
      const signIn = page.getByRole("button", { name: "Sign in", exact: true });
      const lock = page.getByRole("button", { name: "Log out and lock work", exact: true });
      await expect(signIn.or(lock)).toBeVisible();
      if (await lock.isVisible()) await lock.click();
      await expect(signIn).toBeVisible();
      await page.reload();
      await expect(signIn).toBeVisible();
      expect((await page.request.get("/api/sessions/current")).status()).toBe(401);
    }
  }, { auto: true }],
});

test("a clinician can save, close and reopen a new synthetic patient", async ({ page, demoSession }) => {
  await expect(page.getByRole("note", { name: "Clinical Demo tools" })).toBeVisible();
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  const [created] = await Promise.all([
    apiResponse(page, "/api/reports", "POST"),
    page.getByRole("button", { name: "New patient", exact: true }).click(),
  ]);
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  expect(id).toBe(created.request().postDataJSON().reportId);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  try {
    const name = page.locator('[data-element-id="ePatient.03"] input[type=text]');
    const marker = "Demo-" + id.slice(0, 8);
    const [saved] = await Promise.all([
      apiResponse(page, "/api/reports/" + id + "/draft-changes", "POST"),
      (async () => {
        await name.fill(marker);
        await name.press("Tab");
      })(),
    ]);
    expect(saved.ok()).toBe(true);
    await page.getByRole("button", { name: "Save & close", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
    // Reload the workspace and select the exact report from the live directory.
    const listed = apiResponse(page, "/api/reports/open", "GET");
    await page.reload();
    const list = await listed;
    expect(list.ok()).toBe(true);
    const report = (await list.json()).openCalls.find((item: {reportId: string}) => item.reportId === id);
    expect(report).toBeDefined();
    const card = page.getByRole("listitem").filter({ has: page.getByText(report.callNumber, { exact: true }) });
    await card.getByRole("button", { name: "Reopen report" }).click();
    await expect(name).toHaveValue(marker);
    await page.getByRole("button", { name: "Save & close", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
  } finally {
    const deleted = await page.request.delete("/api/reports/" + id, {
      headers: { "x-csrf-token": demoSession.csrfToken },
    });
    expect(deleted.ok(), "Remove the synthetic draft created by this test").toBe(true);
  }
});

test("a reviewer can filter the queue to their assigned work", async ({ page }) => {
  await page.getByRole("button", { name: /^Review\b/ }).click();
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  const mine = page.getByRole("button", { name: /^Assigned to me\b/ });
  const [filtered] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === new URL(page.url()).origin && url.pathname === "/api/review/queue" &&
        url.searchParams.get("assignment") === "mine";
    }),
    mine.click(),
  ]);
  expect(filtered.ok()).toBe(true);
  await expect(page.locator(".review-queue-row")).toHaveCount((await filtered.json()).items.length);
  await expect(mine).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "More filters" }).click();
  await expect(page.getByRole("combobox", { name: "Criterion ID" })).toBeVisible();
});

test("an administrator can inspect units and cancel a new unit", async ({ page }) => {
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  const [units] = await Promise.all([
    apiResponse(page, "/api/admin/units", "GET"),
    page.getByRole("navigation", { name: "Administration panels" }).getByRole("button", { name: "Units" }).click(),
  ]);
  expect(units.ok()).toBe(true);
  const directory = page.getByRole("region", { name: "Units", exact: true });
  await expect(directory.getByRole("row", { name: /^Edit: / })).toHaveCount((await units.json()).items.length);
  await expect(page.getByRole("heading", { name: "Units", exact: true })).toBeVisible();
  const create = page.getByRole("button", { name: "Create unit" });
  await create.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Post-deployment preview");
  await dialog.getByLabel("Call sign", { exact: true }).fill("PREVIEW");
  const [discard] = await Promise.all([
    page.waitForEvent("dialog").then(async prompt => {
      const message = prompt.message();
      await prompt.accept();
      return message;
    }),
    dialog.getByRole("button", { name: "Cancel" }).click(),
  ]);
  expect(discard).toContain("discard");
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
});
