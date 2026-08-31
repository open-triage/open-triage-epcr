import { defineConfig, devices } from "@playwright/test";

const localBasePath = "/open-triage-epcr-demo";
const deployedUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "static-deployment.spec.ts",
  reporter: "line",
  use: {
    baseURL: deployedUrl ?? `http://127.0.0.1:3109${localBasePath}/`,
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: "en-US",
    trace: "retain-on-failure",
  },
  webServer: deployedUrl ? undefined : {
    command: "npm run serve:static -w @open-triage/web",
    env: { PORT: "3109", STATIC_BASE_PATH: localBasePath },
    url: `http://127.0.0.1:3109${localBasePath}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
