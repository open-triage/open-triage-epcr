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
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:identifying", "review:admin"], workspaceAvailable: true };
  let version = 1, status = "in-review", assigneeId = reviewerId;
  let assignmentAttempts = 0, handoffCommentAttempts = 0;
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
    if (path === "/api/installation") return route.fulfill({ json: { settings,
      ...(width === 1440 ? { appearance: { accentColor: "#315ba8", accentDarkColor: "#24447e",
        destructiveColor: "#8a2670", inactiveButtonColor: "#edf1fa", textColor: "#202850" } } : {}) } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/attention") return route.fulfill({ json: { dataset: "real", asOf: now, total: 0, assignments: 0, responses: 0, reopened: 0 } });
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
        { key: "pulse", source: { kind: "nemsis", elementId: "eVitals.06" } }] },
        { key: "observations", name: "Additional observations", fields: [
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
      if (command.body === "Please check the assessment." && ++handoffCommentAttempts === 1)
        return route.fulfill({ status: 503 });
      version++; comments.push({ id: String(version), actorId: reviewerId, actorName: "Reviewer", body: command.body,
        kind: command.kind, itemVersion: version, recordedAt: now });
      return route.fulfill({ json: item() });
    }
    if (path === `/api/review/items/${itemId}/progress`) {
      const command = route.request().postDataJSON(); expect(command.expectedVersion).toBe(version);
      expect(command.outcomeOptionId).toBe(outcomeId); status = command.status; version++;
      return route.fulfill({ json: item() });
    }
    if (path === `/api/review/items/${itemId}/assign`) {
      const command = route.request().postDataJSON(); expect(command.expectedVersion).toBe(version);
      expect(command.assigneeId).toBe(nextReviewer);
      if (++assignmentAttempts === 1) return route.fulfill({ status: 503 });
      assigneeId = nextReviewer; status = "in-review"; version++;
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
  await reason.focus(); await expect(tooltip).toBeVisible();
  await reason.press("Escape"); await expect(tooltip).not.toBeVisible();
  await expect(reason).toBeFocused();
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
  await expect(sidebar.getByRole("tab")).toHaveText(["Actions", "Summary", "History"]);
  const reportItems = sidebar.getByRole("region", { name: "Review items on this report" });
  const activeItem = reportItems.getByRole("button", { name: "Select Timeline", exact: true });
  await expect(activeItem).toHaveAttribute("aria-current", "true");
  await expect(activeItem.locator("..").locator(".status-in-review")).toHaveText("In review");
  await page.screenshot({ path: test.info().outputPath("queue.png") });
  await test.info().attach("Queue and findings", { path: test.info().outputPath("queue.png"), contentType: "image/png" });
  await reportItems.getByRole("button", { name: "Select Clinical assessment", exact: true }).click();
  await expect(reportItems.getByRole("button", { name: "Select Clinical assessment", exact: true })).toHaveAttribute("aria-current", "true");
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
  const sectionSelector = fullReport.locator(".stationary-section-selector");
  const sectionRail = fullReport.getByRole("navigation", { name: "Stationary record sections", exact: true });
  const recordPage = fullReport.locator(".stationary-record-page");
  if (width >= 1440) {
    await expect(sectionSelector).not.toBeVisible();
    await expect(sectionRail).toBeVisible();
    await expect(recordPage).toHaveCSS("overflow-y", "auto");
    const railBounds = await sectionRail.boundingBox();
    const recordBounds = await recordPage.boundingBox();
    expect(recordBounds!.x).toBeGreaterThanOrEqual(railBounds!.x + railBounds!.width);
    expect(Math.abs(recordBounds!.y - railBounds!.y)).toBeLessThanOrEqual(1);
    expect(recordBounds!.width).toBeGreaterThan(railBounds!.width);
    expect(recordBounds!.y + recordBounds!.height).toBeLessThanOrEqual(1000);
    await sectionRail.getByRole("button", { name: /^Additional observations:/ }).click();
    await expect(fullReport.getByRole("heading", { name: "Additional observations", exact: true })).toBeFocused();
    await sectionRail.getByRole("button", { name: /^Original form layout:/ }).click();
    if (width === 1440) await expect(sectionRail.locator(".stationary-section-selection")).toHaveCSS("background-color", "rgb(49, 91, 168)");
  } else {
    await expect(sectionSelector).toBeVisible();
    await expect(sectionRail).not.toBeVisible();
    await sectionSelector.getByRole("combobox").selectOption({ label: "Additional observations" });
    await expect(fullReport.getByRole("heading", { name: "Additional observations", exact: true })).toBeFocused();
    await sectionSelector.getByRole("combobox").selectOption({ label: "Original form layout" });
  }
  await page.screenshot({ path: test.info().outputPath("full-report.png") });
  await test.info().attach("Full report and sidebar", { path: test.info().outputPath("full-report.png"), contentType: "image/png" });
  await fullReport.getByRole("button", { name: /^Timeline/ }).click();
  await expect(fullReport.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
  const timelinePanel = fullReport.getByRole("complementary", { name: "Encounter timeline", exact: true });
  await page.getByRole("tab", { name: "Analytics", exact: true }).click();
  await expect(fullReport).toBeHidden();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(timelinePanel).toBeVisible();
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
  await page.screenshot({ path: test.info().outputPath("stationary-report.png") });
  await test.info().attach("Stationary report layout", { path: test.info().outputPath("stationary-report.png"), contentType: "image/png" });
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
  await expect(sidebar.getByRole("combobox", { name: "Action", exact: true })).toBeVisible();
  await expect(queueTable).not.toBeVisible();
  await expect(fullReport.getByRole("heading", { name: "Original form layout", exact: true })).toBeVisible();
  await fullReport.getByRole("button", { name: "Close full report", exact: true }).click();
  await page.getByRole("heading", { name: "Review queue", exact: true }).hover();
  await expect(queueTable.locator("tbody tr")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(tooltip).not.toBeVisible();
  await sidebar.getByRole("tab", { name: "Actions", exact: true }).click();
  await expect(popup.getByRole("tab", { name: "Discussion", exact: true })).toHaveCount(0);
  await popup.getByRole("combobox", { name: "Action", exact: true }).selectOption("comment");
  await popup.getByRole("textbox", { name: "Comment", exact: true }).fill("Timeline confirmed.");
  await popup.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("");
  await popup.getByRole("combobox", { name: "Action", exact: true }).selectOption("comment");
  await popup.getByRole("textbox", { name: "Comment", exact: true }).fill("Discussed with clinician.");
  await popup.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("");
  await popup.getByRole("tab", { name: "History", exact: true }).click();
  await expect(popup.getByText("Timeline confirmed.", { exact: true })).toBeVisible();
  await expect(popup.getByText("Discussed with clinician.", { exact: true })).toBeVisible();
  await popup.getByRole("tab", { name: "Actions", exact: true }).click();
  await expect(popup.getByRole("combobox", { name: "Action", exact: true }).locator("option[value=forward]")).toHaveCount(0);
  await popup.getByRole("combobox", { name: "Action", exact: true }).selectOption("assign");
  await expect(popup.getByRole("button", { name: "Assign reviewer", exact: true })).toBeDisabled();
  await popup.getByRole("combobox", { name: "Reviewer", exact: true }).selectOption(nextReviewer);
  await popup.getByRole("textbox", { name: "Comment", exact: true }).fill("Please check the assessment.");
  await popup.getByRole("tab", { name: "History", exact: true }).click();
  await popup.getByRole("tab", { name: "Actions", exact: true }).click();
  await expect(popup.getByRole("combobox", { name: "Action", exact: true })).toHaveValue("assign");
  await expect(popup.getByRole("combobox", { name: "Reviewer", exact: true })).toHaveValue(nextReviewer);
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("Please check the assessment.");
  if (width === 1440) await expect(popup.getByRole("button", { name: "Assign reviewer", exact: true })).toHaveCSS("background-color", "rgb(49, 91, 168)");
  await popup.locator(".review-action-form").screenshot({ path: test.info().outputPath("handoff-action.png") });
  await popup.getByRole("button", { name: "Assign reviewer", exact: true }).click();
  await expect(popup.getByText("The comment could not be sent. Retry to check whether it was saved.", { exact: true })).toBeVisible();
  expect(assignmentAttempts).toBe(0);
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("Please check the assessment.");
  await popup.getByRole("button", { name: "Assign reviewer", exact: true }).click();
  await expect(popup.getByText("Your comment was saved. The action could not be completed; try it again.", { exact: true })).toBeVisible();
  expect(assigneeId).toBe(reviewerId);
  await expect(popup.getByRole("combobox", { name: "Action", exact: true })).toHaveValue("assign");
  await expect(popup.getByRole("combobox", { name: "Reviewer", exact: true })).toHaveValue(nextReviewer);
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("");
  await popup.getByRole("button", { name: "Assign reviewer", exact: true }).click();
  await expect.poll(() => assigneeId).toBe(nextReviewer);
  await expect(popup.getByRole("button", { name: "Start review", exact: true })).toHaveCount(0);
  expect(comments.map((entry) => entry.kind)).toEqual(["comment", "comment", "comment"]);
  await expect(popup.getByRole("combobox", { name: "Action", exact: true })).toHaveValue("comment");
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toBeEnabled();
  assigneeId = reviewerId; status = "in-review";
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await page.getByRole("button", { name: "View full report", exact: true }).click();
  await page.getByRole("button", { name: "Close full report", exact: true }).click();
  await page.getByRole("tab", { name: "Actions", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(sidebar.getByRole("combobox", { name: "Action", exact: true }).locator("option[value=complete]")).toHaveCount(1);
  await sidebar.getByRole("combobox", { name: "Action", exact: true }).selectOption("complete");
  await expect(popup.getByRole("button", { name: "Close review", exact: true })).toBeDisabled();
  await sidebar.getByRole("combobox", { name: /^Outcome/ }).selectOption(outcomeId);
  await popup.getByRole("textbox", { name: "Document findings", exact: true }).fill("Final review confirmed.");
  await popup.locator(".review-action-form").screenshot({ path: test.info().outputPath("outcome-action.png") });
  await popup.getByRole("button", { name: "Close review", exact: true }).click();
  await expect.poll(() => status).toBe("completed");
  expect(comments.at(-1)?.body).toBe("Final review confirmed.");
  expect(comments.at(-1)?.kind).toBe("finding");
  await expect(popup.getByRole("combobox", { name: "Action", exact: true })).toHaveValue("comment");
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
    await expect(page.locator("#review-inspector").getByRole("form", { name: "Review action", exact: true })).toBeVisible();
    await report.getByRole("button", { name: "Close full report", exact: true }).click();
    await expect(queue).toBeVisible();
  } finally { releaseReport(); releaseItem(); }
});
