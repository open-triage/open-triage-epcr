import { expect, test } from "@playwright/test";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import syntheticDemoSettings from "@open-triage/contracts/config/installation.synthetic-demo.json";

test("the built static export starts and is served from the domain root", async ({ page, request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const serviceWorker = await request.get("/sw.js");
  expect(serviceWorker.status()).toBe(200);
  expect(await serviceWorker.text()).toContain("demo-assigned-calls.json");

  const installationRequest = page.waitForRequest(
    "https://api.demo.opentriage.org/api/installation",
  );
  await page.route("https://api.demo.opentriage.org/api/installation", async (route) =>
    route.fulfill({
      json: {
        profile: "synthetic-demo",
        settings: syntheticDemoSettings,
        demoLogin: {
          username: SYNTHETIC_DEMO_FIXTURE.administratorUsername,
          password: SYNTHETIC_DEMO_FIXTURE.password,
        },
        fixture: {
          id: SYNTHETIC_DEMO_FIXTURE.id,
          revision: SYNTHETIC_DEMO_FIXTURE.revision,
          activeFormVersionId: SYNTHETIC_DEMO_FIXTURE.formVersionId,
          activeFormVersion: 1,
          activeFormDefinitionSha256: "a".repeat(64),
          sectionCount: SYNTHETIC_DEMO_FIXTURE.expectedSectionCount,
          fieldCount: SYNTHETIC_DEMO_FIXTURE.expectedFieldCount,
        },
      },
    }),
  );
  await page.goto("/");
  await installationRequest;
  await expect(page).toHaveTitle("OpenTriage synthetic encounter");
  await expect(page.getByRole("note", { name: "Prototype safety notice" })).toContainText("Synthetic data only");
  await expect(page.getByRole("heading", { name: "Sign in for your shift" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveValue(SYNTHETIC_DEMO_FIXTURE.administratorUsername);
  await expect(page.getByLabel("Password")).toHaveValue(SYNTHETIC_DEMO_FIXTURE.password);

  const origin = new URL(page.url()).origin;
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.ready).scope))
    .toBe(`${origin}/`);
});
