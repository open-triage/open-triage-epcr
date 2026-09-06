import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testIgnore: "static-deployment.spec.ts",
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
    command: "npm run dev -w @open-triage/web -- --hostname 127.0.0.1 --port 3108",
    env: {
      TMPDIR: process.platform === "darwin" ? "/private/tmp" : "/tmp",
      NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: "true",
      NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE: "synthetic-demo"
    },
    url: "http://127.0.0.1:3108",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
