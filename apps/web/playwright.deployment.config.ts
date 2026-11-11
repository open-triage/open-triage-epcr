import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.PLAYWRIGHT_BASE_URL;
const localUrl = "http://127.0.0.1:3109";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["android-upgrade-policy.spec.ts", "android-audio-layout.spec.ts", "android-pending-tls.spec.ts", "android-tls.spec.ts", "android-reassignment.spec.ts", "response-observer.spec.ts", "android-release.spec.ts", "android-managed-config.spec.ts", "android-lifecycle.spec.ts", "signing-export-controls.spec.ts", "cos-signing.spec.ts", "cos-destinations.spec.ts", "cos-integration-layout.spec.ts", "review-mapping-repair.spec.ts", "review-identifier-correction.spec.ts", "review-delivery-recovery.spec.ts", "review-transmission.spec.ts", "protected-eps.spec.ts", "signed-report-pdf.spec.ts", "review-discussion.spec.ts", "hackathon-demo-patients.spec.ts", "agency-settings.spec.ts", "deployment.spec.ts", "personal-oidc-sessions.spec.ts", "protected-recovery-transitions.spec.ts", "browser-persistence.spec.ts", "authentication-policy.spec.ts", "oidc-draft.spec.ts", "external-identities.spec.ts", "dialog-return-focus.spec.ts", "external-user-approval.spec.ts", "units-directory.spec.ts", "installation-enrollment.spec.ts", "installation-revocation.spec.ts", "installation-reassignment.spec.ts", "schedules.spec.ts", "production-jobs.spec.ts", "production-workflow.spec.ts", "current-shift.spec.ts", "new-job-confirmation.spec.ts", "auditing-panel.spec.ts"],

  // Keep local preflight bounded alongside Android emulators and isolated API suites.
  // An explicit CLI --workers value still permits deliberate larger runs.
  workers: 2,

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
