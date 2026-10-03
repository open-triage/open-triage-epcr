import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import settings from "@open-triage/contracts/config/installation.production.json";

// These cases exercise mouse hover at both narrow and desktop viewport sizes.
test.use({ hasTouch: false });

for (const width of [390, 1440, 1920]) test(`queue rows open inline findings, summary, pinned form and notes at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 });
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API.");
  const reportId = "123e4567-e89b-42d3-a456-426614174111";
  const itemId = "123e4567-e89b-42d3-a456-426614174112";
  const reviewerId = "123e4567-e89b-42d3-a456-426614174114";
  const nextReviewer = "123e4567-e89b-42d3-a456-426614174115";
  const outcomeId = "123e4567-e89b-42d3-a456-426614174116";
  const now = new Date().toISOString();
  const secondItemId = "123e4567-e89b-42d3-a456-426614174117";
  const note = { id: "timeline-note", reportId, type: "text", content: "Arrival clarified in a report note.",
    capturedAt: now, capturedUtcOffsetMinutes: 0, author: { id: reviewerId, displayName: "Reviewer" },
    serverReceivedAt: now, updatedAt: now, persistenceState: "ready" };
  const photo = { ...note, id: "timeline-photo", type: "photo", caption: "Clinical photo", contentType: "image/jpeg", byteSize: 100, sha256: "a".repeat(64), width: 10, height: 10 };
  const audio = { ...note, id: "timeline-audio", type: "audio", caption: "Clinical audio", contentType: "audio/mp4", byteSize: 100, sha256: "b".repeat(64), durationMilliseconds: 1000 };
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 10; canvas.height = 10;
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  const mediaReads: string[] = [];
  const session = { csrfToken: "window-csrf", user: { id: reviewerId, displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: now,
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:identifying"], workspaceAvailable: true };
  let version = 1, status = "in-review", assigneeId = reviewerId;
  const comments: Array<{ id: string; actorId: string; actorName: string; body: string; kind: string; itemVersion: number; recordedAt: string }> = [];
  const item = () => ({ id: itemId, reportId, reportNumber: "PCR-123", criterionId: outcomeId,
    criterionName: "Timeline", criterionDescription: "Confirm the time of arrival.", kind: "criterion", priority: "high",
    status, outcome: null, assigneeId, version, recoveryReason: null, firstMatchedAt: now, reportingDate: "2026-10-02",
    signedAt: now, findings: [], assignmentHistory: [], progressHistory: [], amendmentHistory: [], comments,
    commentsRestricted: false, canComment: true });
  await context.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith(`/api/review/reports/${reportId}/photo/`) || path.startsWith(`/api/review/reports/${reportId}/audio/`)) {
      expect(new URL(route.request().url()).searchParams.get("dataset")).toBe("real");
      mediaReads.push(path);
      return path.includes("/photo/") ? route.fulfill({ contentType: "image/jpeg", body: Buffer.from(image, "base64") }) : route.fulfill({ status: 403 });
    }
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/attention") return route.fulfill({ json: { dataset: "real", asOf: now, assignments: 0, responses: 0, reopened: 0 } });
    if (path === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1, pageSize: 25, total: 1,
      assignmentCounts: { all: 1, mine: 1, unassigned: 0 }, asOf: now, items: [item()] } });
    if (path === `/api/review/items/${itemId}`) return route.fulfill({ json: item() });
    if (path === `/api/review/items/${secondItemId}`) return route.fulfill({ json: { ...item(), id: secondItemId, criterionName: "Clinical assessment", status: "new" } });
    if (path === "/api/review/eligible-reviewers") return route.fulfill({ json: [{ id: nextReviewer, displayName: "Senior reviewer" }] });
    if (path === "/api/review/outcomes") return route.fulfill({ json: [{ id: outcomeId, revision: 1, label: "Reviewed", meaning: "Confirmed", active: true }] });
    if (path === `/api/review/reports/${reportId}`) return route.fulfill({ json: {
      id: reportId, reportingDate: "2026-10-02", signedAt: now, amendmentSequence: 0, identifying: true,
      groups: [{ id: "summary-group", groupId: "custom.summary", parentGroupInstanceId: null, label: "Assessment", ordinal: 0 },
        { id: "empty-group", groupId: "custom.empty", parentGroupInstanceId: null, label: "Empty group", ordinal: 0 }],
      values: [{ id: "summary-value", elementId: "custom.observation", groupInstanceId: "summary-group", label: "Observation", ordinal: 0, valueKind: "string", value: "Documented observation" }],
      notes: [note, photo, audio], reviewItems: [
        { id: itemId, criterionId: outcomeId, criterionName: "Timeline", status, outcome: null },
        { id: secondItemId, criterionId: outcomeId, criterionName: "Clinical assessment", status: "new", outcome: null }],
      clinicalForm: { definition: { sections: [{ key: "saved-layout", name: "Original form layout", fields: [
        { key: "pulse", source: { kind: "nemsis", elementId: "eVitals.06" } },
        { key: "custom-note", source: { kind: "custom", elementDefinitionId: "custom-note" } }] }] },
        catalogFields: {}, customFields: { "custom-note": { id: "custom-note", namespace: "test", slug: "Note", title: "Saved observation", datatype: "string", recurrence: "single", usage: "Optional", identifying: true, constraints: { maxLength: 120 } } } },
      document: { $schema: "https://opentriage.org/schemas/encounter-document/v1", documentType: "open-triage.encounter", modelVersion: "1",
        dataModel: { standard: "NEMSIS", version: "3.5.0", dataset: "EMSDataSet" }, formProfile: { id: "original-form", version: "1" },
        encounter: { id: reportId, createdAt: now, updatedAt: now }, groups: [
          { id: "eTimesSection", instances: [{ instanceId: "times-instance", elements: [{ id: "eTimes.06", values: [{ occurrenceId: "arrival", kind: "scalar", value: now }] }] }] },
          { id: "eVitals.VitalGroup", instances: [{ instanceId: "vitals-instance", elements: [{ id: "eVitals.01", values: [{ occurrenceId: "vital-time", kind: "scalar", value: now }] }] }] },
          { id: "eVitals.BloodPressureGroup", instances: [{ instanceId: "bp-instance", parentInstanceId: "vitals-instance", elements: [{ id: "eVitals.06", values: [{ occurrenceId: "pulse", kind: "scalar", value: 90 }] }] }] },
          { id: "PatientCareReportGroup", instances: [{ instanceId: "custom-instance", elements: [{ id: "test.Note", values: [{ occurrenceId: "note", kind: "scalar", value: "Documented observation" }] }] }] }] },
    } });
    if (path === `/api/review/items/${itemId}/comments`) {
      const command = route.request().postDataJSON();
      expect(command.expectedVersion).toBe(version);
      expect(route.request().headers()["x-csrf-token"]).toBe("window-csrf");
      version++; comments.push({ id: String(version), actorId: reviewerId, actorName: "Reviewer", body: command.body,
        kind: command.kind, itemVersion: version, recordedAt: now });
      return route.fulfill({ json: item() });
    }
    if (path === `/api/review/items/${itemId}/progress`) {
      const command = route.request().postDataJSON(); expect(command.expectedVersion).toBe(version);
      expect(command.outcomeOptionId).toBe(outcomeId); status = command.status; version++;
      return route.fulfill({ json: item() });
    }
    if (path === `/api/review/items/${itemId}/forward`) {
      const command = route.request().postDataJSON(); expect(command.expectedVersion).toBe(version);
      expect(command.assigneeId).toBe(nextReviewer); assigneeId = nextReviewer; status = "new"; version++;
      return route.fulfill({ json: item() });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "All reviews 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Select and manage multiple reviews", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Last checked|New assignments:|Clinician responses requested:|Reopened reviews:/)).toHaveCount(0);
  const row = page.getByRole("button", { name: "View PCR-123", exact: true });
  const reason = page.locator(".review-row-criterion");
  const tooltip = page.getByRole("tooltip");
  await row.focus(); await expect(tooltip).not.toBeVisible();
  await page.locator(".review-queue-row td").nth(3).hover();
  await expect(tooltip).not.toBeVisible();
  await reason.hover(); await expect(tooltip).toBeVisible();
  await row.hover(); await expect(tooltip).not.toBeVisible();
  await page.getByRole("heading", { name: "Review queue", exact: true }).hover();
  await reason.focus(); await expect(tooltip).not.toBeVisible();
  const queueTable = page.getByRole("table", { name: "Review queue", exact: true });
  await expect(queueTable.locator("tbody tr td").nth(1).getByRole("button")).toHaveCount(0);
  await expect(queueTable.locator("tbody tr td").nth(7).getByRole("button", { name: "View PCR-123", exact: true })).toHaveText("View");
  await queueTable.getByRole("checkbox").check();
  await expect(page.locator("#review-inspector")).toHaveCount(0);
  await queueTable.getByRole("checkbox").uncheck();
  const pagesBefore = context.pages().length;
  await queueTable.locator("tbody tr td").nth(3).click();
  const popup = page;
  const sidebar = page.locator("#review-inspector");
  await expect(sidebar).toBeVisible();
  expect(context.pages()).toHaveLength(pagesBefore);
  if (width >= 1440) {
    await expect.poll(() => page.locator(".review-table-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await expect(sidebar.getByRole("tab")).toHaveText(["Findings", "Summary", "History"]);
  const reportItems = sidebar.getByRole("region", { name: "Review items on this report" });
  const activeItem = reportItems.getByRole("button", { name: /^Timeline/ });
  await expect(activeItem).toHaveAttribute("aria-current", "true");
  await expect(activeItem.locator(".status-in-review")).toHaveText("In review");
  await page.screenshot({ path: test.info().outputPath("queue.png") });
  await test.info().attach("Queue and findings", { path: test.info().outputPath("queue.png"), contentType: "image/png" });
  await reportItems.getByRole("button", { name: /^Clinical assessment/ }).click();
  await expect(reportItems.getByRole("button", { name: /^Clinical assessment/ })).toHaveAttribute("aria-current", "true");
  await activeItem.click();
  await expect(activeItem).toHaveAttribute("aria-current", "true");
  await sidebar.getByRole("tab", { name: "Summary", exact: true }).click();
  await expect(sidebar.getByRole("heading", { name: "Assessment", exact: true })).toBeVisible();
  await expect(sidebar.getByText("Documented observation", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("heading", { name: "Empty group", exact: true })).toHaveCount(0);
  await expect(queueTable).toBeVisible();
  await sidebar.getByRole("button", { name: "View full report", exact: true }).click();
  await expect(queueTable).not.toBeVisible();
  const fullReport = page.getByRole("article", { name: "Full report", exact: true });
  await expect(fullReport.getByRole("region", { name: "Review items on this report" })).toHaveCount(0);
  await expect(sidebar).toHaveCSS("position", "fixed");
  await expect(page.getByRole("button", { name: "Back to queue", exact: true })).toHaveCount(0);
  await activeItem.focus(); await page.keyboard.press("Escape");
  await expect(sidebar).toHaveCount(0);
  const findingsToggle = fullReport.getByRole("button", { name: "Findings", exact: true });
  await expect(findingsToggle).toBeFocused();
  await findingsToggle.click();
  await expect(sidebar).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("full-report.png") });
  await test.info().attach("Full report and sidebar", { path: test.info().outputPath("full-report.png"), contentType: "image/png" });
  await fullReport.getByRole("button", { name: /^Timeline/ }).click();
  await expect(fullReport.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
  const timelinePanel = fullReport.getByRole("complementary", { name: "Encounter timeline", exact: true });
  await expect(timelinePanel).toHaveCSS("position", "fixed");
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(async () => {
    const toolbar = await fullReport.locator(".review-report-toolbar").boundingBox();
    const bounds = await timelinePanel.boundingBox();
    return Math.abs(bounds!.y - toolbar!.y - toolbar!.height);
  }).toBeLessThanOrEqual(1);
  await expect(fullReport.locator(".timeline-list").getByText("Unit Arrived on Scene", { exact: true })).toBeVisible();
  await fullReport.getByRole("button", { name: /Open text note at/ }).click();
  await expect(page.getByRole("dialog").getByText(note.content, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await fullReport.getByRole("button", { name: /Open photo note at/ }).click();
  const photoDialog = page.getByRole("dialog");
  await expect(photoDialog.getByRole("img", { name: "Clinical photo", exact: true })).toBeVisible();
  await expect.poll(() => photoDialog.getByRole("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(10);
  await page.keyboard.press("Escape");
  await fullReport.getByRole("button", { name: /Open audio note at/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Play audio note", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect(mediaReads).toContain(`/api/review/reports/${reportId}/audio/${audio.id}/content`);
  await page.keyboard.press("Escape");
  await timelinePanel.getByRole("button", { name: "All", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(timelinePanel).toHaveCount(0);
  await expect(fullReport.getByRole("button", { name: /^Timeline/ })).toBeFocused();
  await fullReport.getByRole("button", { name: "Findings", exact: true }).click();
  await expect(sidebar).toHaveCount(0);
  await expect(popup.getByRole("heading", { name: "Original form layout", exact: true })).toBeVisible();
  await expect(popup.getByRole("textbox", { name: /Saved observation/ })).toBeDisabled();
  await expect(popup.getByRole("textbox", { name: /Saved observation/ })).toHaveValue("Documented observation");
  await popup.getByRole("button", { name: /^View .* row$/ }).first().click();
  const dialog = popup.getByRole("dialog");
  await expect(dialog.getByText("90", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await popup.getByRole("button", { name: "Close full report", exact: true }).click();
  await expect(queueTable).toBeVisible();
  await expect(activeItem).toHaveAttribute("aria-current", "true");
  await row.click();
  await expect(sidebar.getByLabel("Entry type")).toBeVisible();
  await expect(queueTable).not.toBeVisible();
  await expect(fullReport.getByRole("heading", { name: "Original form layout", exact: true })).toBeVisible();
  await fullReport.getByRole("button", { name: "Close full report", exact: true }).click();
  await page.getByRole("heading", { name: "Review queue", exact: true }).hover();
  await expect(queueTable.locator("tbody tr")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(tooltip).not.toBeVisible();
  await sidebar.getByRole("tab", { name: "Findings", exact: true }).click();
  await expect(popup.getByRole("tab", { name: "Discussion", exact: true })).toHaveCount(0);
  await popup.getByLabel("Entry type").selectOption("finding");
  await popup.getByRole("textbox", { name: "Document findings", exact: true }).fill("Timeline confirmed.");
  await popup.getByRole("button", { name: "Save findings", exact: true }).click();
  await expect(popup.getByRole("textbox", { name: "Document findings", exact: true })).toHaveValue("");
  await popup.getByLabel("Entry type").selectOption("comment");
  await popup.getByRole("textbox", { name: "Comment", exact: true }).fill("Discussed with clinician.");
  await popup.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("");
  await popup.getByRole("tab", { name: "History", exact: true }).click();
  await expect(popup.getByText("Timeline confirmed.", { exact: true })).toBeVisible();
  await expect(popup.getByText("Discussed with clinician.", { exact: true })).toBeVisible();
  await popup.getByRole("tab", { name: "Findings", exact: true }).click();
  await popup.getByLabel("Send to reviewer").selectOption(nextReviewer);
  await popup.getByRole("button", { name: "Send for further review", exact: true }).click();
  await expect.poll(() => assigneeId).toBe(nextReviewer);
  await expect(popup.getByRole("button", { name: "Start review", exact: true })).toHaveCount(0);
  expect(comments.map((entry) => entry.kind)).toEqual(["finding", "comment"]);
  assigneeId = reviewerId; status = "in-review";
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await page.getByRole("button", { name: "View full report", exact: true }).click();
  await page.getByRole("button", { name: "Close full report", exact: true }).click();
  await page.getByRole("tab", { name: "Findings", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sidebar.getByRole("combobox", { name: /^Outcome/ }).selectOption(outcomeId);
  await popup.getByRole("button", { name: "Complete item", exact: true }).click();
  await expect.poll(() => status).toBe("completed");
  const results = await new AxeBuilder({ page: popup }).analyze();
  expect(results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
  await expect(sidebar.locator(".status-completed").first()).toHaveText("Completed");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const unsigned of [false, true]) test(`View loads the ${unsigned ? "overdue draft" : "signed report"} while item details are pending`, async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reportId = "123e4567-e89b-42d3-a456-426614174201";
  const itemId = "123e4567-e89b-42d3-a456-426614174202";
  const now = new Date().toISOString();
  const session = { csrfToken: "csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: now,
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  const item = { id: itemId, reportId, reportNumber: "PCR-201", criterionId: "criterion", criterionName: "Assessment",
    kind: unsigned ? "overdue-unsigned" : "criterion", signedAt: unsigned ? null : now,
    priority: "high", status: "new", assigneeId: null, version: 0, firstMatchedAt: now, findings: [] };
  let releaseItem!: () => void;
  let releaseReport!: () => void;
  const itemReady = new Promise<void>((resolve) => { releaseItem = resolve; });
  const reportReady = new Promise<void>((resolve) => { releaseReport = resolve; });
  const reads: string[] = [];
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.context().route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1, pageSize: 25,
      total: 1, asOf: now, items: [item] } });
    if (path === `/api/review/items/${itemId}`) {
      await itemReady;
      return route.fulfill({ json: { ...item, comments: [], assignmentHistory: [], progressHistory: [] } });
    }
    if (path === `/api/review/reports/${reportId}` || path === `/api/review/items/${itemId}/draft`) {
      reads.push(path);
      await reportReady;
      return route.fulfill({ json: { id: reportId, itemId, signedAt: unsigned ? null : now, deadlineAt: now, deadlineSource: "call-completed", amendmentSequence: 0,
        groups: [], notes: [], values: [{ id: "observation", elementId: "custom.note", groupInstanceId: null,
          label: "Observation", ordinal: 0, valueKind: "text", value: "Documented while item details load" }] } });
    }
    return route.fulfill({ status: 404 });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "View PCR-201", exact: true }).click();
    const report = page.getByRole("article", { name: "Full report", exact: true });
    const queue = page.getByRole("table", { name: "Review queue", exact: true });
    await expect(queue).not.toBeVisible();
    await expect(report.getByRole("status")).toBeVisible();
    await expect.poll(() => reads).toEqual([unsigned ? `/api/review/items/${itemId}/draft` : `/api/review/reports/${reportId}`]);
    // The loading screen can be closed before either response arrives.
    await report.getByRole("button", { name: "Close full report", exact: true }).click();
    await expect(queue).toBeVisible();
    await page.getByRole("button", { name: "View PCR-201", exact: true }).click();
    releaseReport();
    await expect(report.getByText("Documented while item details load", { exact: true })).toBeVisible();
    await expect(queue).not.toBeVisible();
    expect(reads).toHaveLength(1);
    releaseItem();
    await expect(page.locator("#review-inspector").getByText("Status: New", { exact: false })).toBeVisible();
    await report.getByRole("button", { name: "Close full report", exact: true }).click();
    await expect(queue).toBeVisible();
  } finally { releaseReport(); releaseItem(); }
});
