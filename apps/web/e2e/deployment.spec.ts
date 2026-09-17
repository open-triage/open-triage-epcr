import { expect, test } from "@playwright/test";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;
if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_URL must be set for deployment tests");
}
const installationUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/installation`;

test("the built static export starts and is served from the domain root", async ({ page, request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const serviceWorker = await request.get("/sw.js");
  expect(serviceWorker.status()).toBe(200);
  expect(await serviceWorker.text()).not.toContain("demo-assigned-calls.json");

  const installationRequest = page.waitForRequest(installationUrl);
  await page.route(installationUrl, async (route) =>
    route.fulfill({
      json: {
        settings: productionSettings,
      },
    }),
  );
  await page.goto("/");
  await installationRequest;
  await expect(page).toHaveTitle("OpenTriage synthetic encounter");
  await expect(page.getByText(productionSettings.signIn.brandText, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveValue("");
  await expect(page.getByLabel("Password")).toHaveValue("");

  const origin = new URL(page.url()).origin;
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.ready).scope))
    .toBe(`${origin}/`);
});
