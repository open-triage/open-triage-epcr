import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.PLAYWRIGHT_BASE_URL;
const localUrl = "http://127.0.0.1:3109";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["deployment.spec.ts", "personal-oidc-sessions.spec.ts", "protected-recovery-transitions.spec.ts", "browser-persistence.spec.ts", "authentication-policy.spec.ts", "oidc-draft.spec.ts", "regional-identities.spec.ts", "regional-user-approval.spec.ts", "units-directory.spec.ts", "installation-enrollment.spec.ts", "installation-revocation.spec.ts", "installation-reassignment.spec.ts", "schedules.spec.ts", "production-jobs.spec.ts", "current-shift.spec.ts", "new-job-confirmation.spec.ts"],
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
    command: "npm start",
    env: { PORT: "3109" },
    url: localUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
