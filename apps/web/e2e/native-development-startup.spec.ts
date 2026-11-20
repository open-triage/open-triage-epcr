import { expect, test } from "@playwright/test";
import { DEFAULT_AGENCY_APPEARANCE } from "@open-triage/contracts";
import settings from "@open-triage/contracts/config/installation.production.json";

test("development UI renders without the debugging WebSocket used outside native HTTP transport", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  // The APK forwards approved HTTP resources, but cannot forward Next's debug socket.
  let sockets = 0;
  await page.routeWebSocket("**/*", socket => { sockets++; socket.close(); });
  await page.route("**/api/**", route => {
    if (new URL(route.request().url()).pathname === "/api/installation") {
      return route.fulfill({ json: { settings, appearance: DEFAULT_AGENCY_APPEARANCE } });
    }
    return route.fulfill({ status: 401, json: { message: "Unauthorized" } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("native-startup-fixture");
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue("native-startup-fixture");
  expect(sockets).toBeGreaterThan(0); // Ordinary browser development still connects to HMR.
});

test("Android development stays on the current screen beyond the HMR reconnect budget", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  await page.clock.install();
  let sockets = 0;
  await page.routeWebSocket("**/*", socket => { sockets++; socket.close(); });
  await page.addInitScript(({ settings, appearance }) => {
    const runtime = window as unknown as Record<string, unknown>;
    runtime.androidBridge = {};
    runtime.Capacitor = {
      PluginHeaders: [
        { name: "OpenTriageLifecycle", methods: ["state", "addListener", "removeListener"].map(name => ({ name, rtype: "promise" })) },
        { name: "OpenTriageConnection", methods: ["state", "version", "refreshInstallation", "request", "addListener", "removeListener", "finishAuthentication", "resumePersonalSession"].map(name => ({ name, rtype: "promise" })) },
      ],
      nativePromise: async (plugin: string, method: string, options: { path?: string }) => {
        if (method === "addListener") return "synthetic-listener";
        if (method === "version") return { versionCode: 1 };
        if (method === "finishAuthentication") return { outcome: "idle" };
        if (method === "resumePersonalSession") return {};
        if (plugin === "OpenTriageLifecycle") return { active: true };
        if (method === "request") return {
          status: options.path === "/api/installation" ? 200 : 401,
          headers: { "content-type": "application/json" },
          bodyBase64: btoa(JSON.stringify(options.path === "/api/installation" ? { settings, appearance } : { message: "Unauthorized" })),
        };
        return { configured: true, blocked: false, connectionContext: "synthetic-connection", storageScope: "s".repeat(43), origin: "https://paired.example" };
      },
    };
    sessionStorage.setItem("stability-loads", String(Number(sessionStorage.getItem("stability-loads") ?? 0) + 1));
  }, { settings, appearance: DEFAULT_AGENCY_APPEARANCE });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toBeVisible();
  await username.fill("preserved-native-input");
  // Allow each chained reconnect timer to run, coalescing unrelated frame and interval callbacks.
  const advancePastReconnectBudget = async () => {
    for (let attempt = 0; attempt < 14; attempt++) await page.clock.fastForward(5_000);
  };
  await advancePastReconnectBudget();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await advancePastReconnectBudget();
  await expect(username).toHaveValue("preserved-native-input");
  expect(await page.evaluate(() => sessionStorage.getItem("stability-loads"))).toBe("1");
  expect(sockets).toBe(0);
});
