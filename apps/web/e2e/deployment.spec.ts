import { expect, test } from "@playwright/test";

test("the Kubernetes web artifact is served from the domain root", async ({ page, request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);

  await page.goto("/");
  await expect(page).toHaveTitle("OpenTriage synthetic encounter");
  await expect(page.getByRole("heading", { name: "Sign in for your shift" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  const origin = new URL(page.url()).origin;
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.ready).scope))
    .toBe(`${origin}/`);
});
