import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.PLAYWRIGHT_BASE_URL;
const localUrl = "http://127.0.0.1:3109";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "deployment.spec.ts",
  reporter: "line",
  use: {
    baseURL: deployedUrl ?? localUrl,
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: "en-US",
    trace: "retain-on-failure",
  },
  webServer: deployedUrl ? undefined : {
    command: "npm run serve:static",
    env: { PORT: "3109" },
    url: localUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
