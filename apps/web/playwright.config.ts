import { defineConfig, devices } from "@playwright/test";

const serverBackedMock = process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "deployment.spec.ts",
  fullyParallel: true,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3108",
    browserName: "chromium",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "android-360x800", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, hasTouch: true } },
    { name: "android-390x844", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3108",
    env: {
      TMPDIR: process.platform === "darwin" ? "/private/tmp" : "/tmp",
      OPEN_TRIAGE_E2E_DIST_DIR: ".next-e2e",
      ...(serverBackedMock
        ? { NEXT_PUBLIC_API_URL: "http://127.0.0.1:3108" }
        : { NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: "true", NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API: "true" }),
    },
    url: "http://127.0.0.1:3108",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
