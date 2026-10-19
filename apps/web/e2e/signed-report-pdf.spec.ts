import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import settings from "@open-triage/contracts/config/installation.production.json";

// Real renderer bytes keep the browser journey coupled to the clinical artifact tested by the API.
const pdf = execFileSync(process.execPath, ["--input-type=module", "-e", `
  import { renderSignedReportPdf } from './apps/api/dist/reports/signed-report-pdf.js';
  import { signedPdfFixture } from './apps/api/tests/fixtures/signed-pdf-source.mjs';
  process.stdout.write(await renderSignedReportPdf(signedPdfFixture().source, 'en'));
`], { cwd: resolve(process.cwd(), "../..") });

for (const width of [390, 1440]) test(`signed PDF inspection retains exact version and handles failure at ${width}px`, async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API");
  await page.setViewportSize({ width, height: 900 });
  const reportId = "11111111-1111-4111-8111-111111111111";
  const snapshotId = "22222222-2222-4222-8222-222222222222";
  const itemId = "44444444-4444-4444-8444-444444444444";
  const session = { csrfToken: "csrf", user: { id: "33333333-3333-4333-8333-333333333333", displayName: "Alex Example" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-19T08:00:00Z",
    expiresAt: "2099-10-19T20:00:00Z", capabilities: ["review:self"], workspaceAvailable: true };
  const item = { id: itemId, reportId, reportNumber: "PDF-001", criterionId: itemId, criterionName: "Clinical review",
    kind: "criterion", priority: "high", status: "new", outcome: null, assigneeId: session.user.id, version: 1,
    recoveryReason: null, firstMatchedAt: "2026-10-19T11:00:00Z", reportingDate: "2026-10-19", signedAt: "2026-10-19T11:00:00Z",
    findings: [], assignmentHistory: [], progressHistory: [], comments: [], commentsRestricted: false, canComment: true };
  let fail = true;
  let reads = 0;
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings, appearance: {
      accentColor: "#315ba8", accentDarkColor: "#24447e", destructiveColor: "#8a2670", inactiveButtonColor: "#edf1fa", textColor: "#202850" } } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/attention") return route.fulfill({ json: { dataset: "real", asOf: "2026-10-19", total: 1, assignments: 1, responses: 0, reopened: 0 } });
    if (path === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1, pageSize: 25, total: 1,
      asOf: "2026-10-19T11:00:00Z", items: [item] } });
    if (path === `/api/review/items/${itemId}`) return route.fulfill({ json: item });
    if (path === `/api/review/reports/${reportId}`) return route.fulfill({ json: { id: reportId, signedSnapshotId: snapshotId,
      signedRevision: 7, reportingDate: "2026-10-19", signedAt: item.signedAt, amendmentSequence: 1,
      identifying: true, groups: [], values: [], notes: [], reviewItems: [] } });
    if (path === `/api/review/reports/${reportId}/snapshots/${snapshotId}/pdf`) {
      reads++;
      expect(url.searchParams.get("amendmentSequence")).toBe("1");
      expect(url.searchParams.get("dataset")).toBe("real");
      expect(route.request().headers()["x-organization-id"]).toBe("organization");
      return fail ? route.fulfill({ status: 422, json: { code: width === 390 ? "pdf.amendment-evidence-unavailable" : "pdf.unsupported-text" } }) :
        route.fulfill({ contentType: "application/pdf", body: pdf });
    }
    if (path === "/api/review/outcomes" || path === "/api/review/eligible-reviewers") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "View PDF-001", exact: true }).click();
  const preview = page.getByRole("button", { name: "Inspect signed PDF", exact: true }).first();
  await expect(preview).toBeVisible();
  await preview.click();
  const dialog = page.getByRole("dialog", { name: "Inspect signed PDF" });
  await expect(dialog.getByRole("alert")).toContainText(width === 390 ? "Ask your administrator to investigate the signed amendment history" : "cannot render faithfully");
  fail = false;
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /^blob:/);
  await expect(dialog.getByText("Signed clinical version through amendment 1.")).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.height).toBeLessThanOrEqual(900);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(`${reportId}-1.pdf`);
  expect(await readFile((await download.path())!)).toEqual(pdf);
  await page.screenshot({ path: `test-results/signed-pdf-${width}.png` });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(preview).toBeFocused();
  expect(reads).toBe(2);
});
