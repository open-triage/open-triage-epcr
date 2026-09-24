import { defineConfig, devices } from "@playwright/test";

const serverBackedMock = process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true";
const serverPort = process.env.OPEN_TRIAGE_E2E_PORT ?? "3108";
const serverUrl = `http://127.0.0.1:${serverPort}`;
// Clinical persistence needs the server API and protected IndexedDB, while
// local-demo/admin scenarios deliberately exercise the static installation.
// Both disjoint sets run in test:e2e; neither mode can silently skip the other.
const serverTests = ["accessibility-journey.spec.ts", "assigned-calls.spec.ts", "browser-persistence.spec.ts",
  "complete-mobile-journey.spec.ts", "feedback.spec.ts", "presentation-mode.spec.ts", "stationary-completion-journey.spec.ts",
  "stationary-navigation.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  ...(serverBackedMock ? { testMatch: serverTests } : { testIgnore: ["deployment.spec.ts", ...serverTests] }),
  outputDir: "playwright-results/e2e",
  fullyParallel: true,
  workers: 2,
  reporter: "line",
  use: {
    baseURL: serverUrl,
    browserName: "chromium",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "android-360x800", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, hasTouch: true } },
    { name: "android-390x844", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: `mkdir -p playwright-artifacts && exec npm run dev -- --hostname 127.0.0.1 --port ${serverPort} > playwright-artifacts/e2e-server.log 2>&1`,
    env: {
      TMPDIR: process.env.TMPDIR ?? (process.platform === "darwin" ? "/private/tmp" : "/tmp"),
      ...(serverBackedMock
        ? { NEXT_PUBLIC_API_URL: serverUrl }
        : { NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: "true", NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API: "true" }),
    },
    url: serverUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
