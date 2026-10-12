import { expect, test } from "@playwright/test";

test("main host serves the landing page and demo subdomain supports an isolated session", async ({ page, context }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("OpenTriage — Open-source patient care reporting");
  const demoLink = page.getByRole("link", { name: "Try the demo" });
  await expect(demoLink).toHaveAttribute("href", "http://demo.localhost:3000/");
  const css = await page.request.get("/site.css");
  expect(css.headers()["content-type"]).toContain("text/css");
  await demoLink.click();
  await expect(page).toHaveURL("http://demo.localhost:3000/");
  await page.getByLabel("Username", { exact: true }).fill("demo");
  await page.getByLabel("Password", { exact: true }).fill("opentriagedemo");
  const loginResponse = page.waitForResponse(response => response.url().endsWith("/api/sessions") && response.request().method() === "POST");
  const callsResponse = page.waitForResponse(response => response.url().endsWith("/api/calls/assigned") && response.ok());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const login = await loginResponse;
  expect(login.status()).toBe(201);
  expect(new URL(login.url()).hostname).toBe("demo.localhost");
  const session = await login.json();
  try {
    await callsResponse;
    const cookies = await context.cookies("http://demo.localhost:3001/api/sessions/current");
    expect(cookies.some(cookie => cookie.name === "open_triage_session" && cookie.domain === "demo.localhost")).toBe(true);
    expect((await context.cookies("http://test.localhost:3001/api/sessions/current")).some(cookie => cookie.name === "open_triage_session")).toBe(false);
    const restored = page.waitForResponse(response => response.url().endsWith("/api/sessions/current") && response.ok());
    await page.reload();
    await restored;
  } finally {
    await page.evaluate(async ({ url, csrfToken }) => {
      await fetch(`${url}/current`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": csrfToken } });
    }, { url: login.url(), csrfToken: session.csrfToken });
  }
});
