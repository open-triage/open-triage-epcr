import { defineConfig, devices } from "@playwright/test";

const localUrl = "http://127.0.0.1:3118";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "critical-clinical-journey.spec.ts",
  fullyParallel: true,
  timeout: 60_000,
  outputDir: "playwright-results/critical",
  reporter: "line",
  use: {
    baseURL: localUrl,
    browserName: "chromium",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "android-360x800", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, hasTouch: true } },
    { name: "android-390x844", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: "mkdir -p playwright-artifacts && exec npm start > playwright-artifacts/critical-server.log 2>&1",
    env: { PORT: "3118" },
    url: localUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
