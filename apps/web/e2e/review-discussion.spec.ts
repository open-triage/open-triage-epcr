import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("reviewer requests a clinician response and both see the scoped discussion", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const reportId = "123e4567-e89b-42d3-a456-426614174111";
  const itemId = "123e4567-e89b-42d3-a456-426614174112";
  const criterionId = "123e4567-e89b-42d3-a456-426614174113";
  const reviewer = "123e4567-e89b-42d3-a456-426614174114";
  const clinician = "123e4567-e89b-42d3-a456-426614174115";
  const sessionFor = (id: string, identifying = true) => ({ csrfToken: "discussion-csrf",
    user: { id, displayName: id === reviewer ? "Reviewer" : "Clinician" },
    organization: { id: "organization", name: "Example EMS" },
    startedAt: "2026-10-02T08:00:00Z", expiresAt: "2099-10-02T20:00:00Z",
    capabilities: [id === reviewer ? "review:all" : "review:self",
      ...(identifying ? ["review:identifying"] : [])], workspaceAvailable: true });
  let session = sessionFor(reviewer);
  let status = "in-review";
  let version = 1;
  const comments: Array<{ id: string; actorId: string; actorName: string; body: string;
    itemVersion: number; recordedAt: string }> = [];
  let detailReads = 0;
  const item = () => ({ id: itemId, reportId, criterionId, kind: "criterion", priority: "high",
    status, outcome: null, assigneeId: reviewer, version, recoveryReason: null,
    firstMatchedAt: "2026-10-02T07:00:00Z", reportingDate: "2026-10-02",
    signedAt: "2026-10-02T07:00:00Z", findings: [], assignmentHistory: [], progressHistory: [],
    comments: session.capabilities.includes("review:identifying") ? comments : [],
    commentsRestricted: !session.capabilities.includes("review:identifying"),
    canComment: session.capabilities.includes("review:identifying") });
  await page.addInitScript((stored) => {
    if (!localStorage.getItem("open-triage.clinician-session.v1"))
      localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored));
  }, session);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/reports") return route.fulfill({ json: { dataset: "real",
      scope: session.user.id === reviewer ? "all" : "own", identifying: session.capabilities.includes("review:identifying"),
      administrator: false, page: 1, pageSize: 25, total: 1, asOf: new Date().toISOString(),
      reports: [{ id: reportId, reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z" }] } });
    if (path === `/api/review/reports/${reportId}`) return route.fulfill({ json: { id: reportId,
      reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z", amendmentSequence: 0,
      identifying: session.capabilities.includes("review:identifying"), groups: [], values: [], notes: [],
      reviewItems: [{ id: itemId, criterionId, status, outcome: null }] } });
    if (path === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 1, asOf: new Date().toISOString(), items: [item()] } });
    if (path === "/api/review/outcomes") return route.fulfill({ json: [] });
    if (path === `/api/review/items/${itemId}`) { detailReads++; return route.fulfill({ json: item() }); }
    if (path === `/api/review/items/${itemId}/progress`) {
      expect(route.request().headers()["x-csrf-token"]).toBe("discussion-csrf");
      const command = route.request().postDataJSON() as { status: string; expectedVersion: number };
      expect(command.expectedVersion).toBe(version);
      status = command.status; version++;
      return route.fulfill({ json: item() });
    }
    if (path === `/api/review/items/${itemId}/comments`) {
      expect(route.request().headers()["x-csrf-token"]).toBe("discussion-csrf");
      const command = route.request().postDataJSON() as { body: string; expectedVersion: number };
      expect(command.expectedVersion).toBe(version);
      expect(session.capabilities).toContain("review:identifying");
      version++;
      comments.push({ id: crypto.randomUUID(), actorId: session.user.id,
        actorName: session.user.displayName, body: command.body, itemVersion: version,
        recordedAt: new Date().toISOString() });
      return route.fulfill({ json: item() });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: reportId }).first().click();
  await page.getByRole("button", { name: "Await clinician" }).click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Please clarify the timeline.");
  await page.getByRole("button", { name: "Send comment" }).click();
  await expect(page.getByText("Please clarify the timeline.")).toBeVisible();
  expect(status).toBe("awaiting-clinician");

  session = sessionFor(clinician);
  await page.evaluate((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.reload();
  await page.getByRole("button", { name: reportId }).last().click();
  await page.getByRole("button", { name: criterionId }).click();
  await expect.poll(() => detailReads).toBeGreaterThan(1);
  await expect(page.getByText("Please clarify the timeline.")).toBeVisible();
  await page.getByRole("textbox", { name: "Comment" }).fill("The event occurred after arrival.");
  await page.getByRole("button", { name: "Send comment" }).click();
  await expect(page.getByText("The event occurred after arrival.")).toBeVisible();
  expect(comments.map((entry) => entry.actorId)).toEqual([reviewer, clinician]);

  session = sessionFor(clinician, false);
  await page.evaluate((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.reload();
  await page.getByRole("button", { name: reportId }).last().click();
  await page.getByRole("button", { name: criterionId }).click();
  await expect(page.getByText("Awaiting clinician").last()).toBeVisible();
  await expect(page.getByText("Discussion text requires Review identifying access. Status and outcomes remain available.")).toBeVisible();
  await expect(page.getByText("Please clarify the timeline.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send comment" })).toHaveCount(0);
});
