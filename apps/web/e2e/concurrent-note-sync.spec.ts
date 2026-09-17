import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall, EncounterDocument, OpenAssignmentResponse } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import { saveCanonicalEvent } from "../app/canonical-events";
import { bundledEncounterDefinition } from "../app/standard-encounter";

const assignedCall = demoAssignedCalls.assignedCalls[0] as AssignedCall;
const reportId = demoOpenAssignment.report.id;
const sharedNoteId = "shared-clinical-note";

function noteDocument(summary: string, firstName?: string): EncounterDocument {
  const document = saveCanonicalEvent(structuredClone(demoOpenAssignment.report.document) as EncounterDocument, {
    id: sharedNoteId,
    date: "2026-09-03",
    time: "12:01",
    kind: "note",
    title: "Clinical note",
    detail: summary,
    reference: "eNarrative.01",
    visitorEntered: true,
  }, bundledEncounterDefinition);
  if (!firstName) return document;
  return {
    ...document,
    groups: document.groups.map((group) => group.id !== "ePatient.PatientNameGroup" ? group : ({
      ...group,
      instances: group.instances.map((instance) => ({
        ...instance,
        elements: instance.elements.map((element) => element.id !== "ePatient.03" ? element : ({
          ...element,
          values: element.values.map((value) => value.kind === "scalar" ? { ...value, value: firstName } : value),
        })),
      })),
    })),
  };
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

function assignedCalls(route: Route) {
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({
    assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString(),
  }) });
}

test("mobile and stationary clients converge a conflicting clinical-note replacement without losing server edits", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  let revision = 1;
  let serverDocument = noteDocument("Original shared note");
  const commands = { a: [] as Array<Record<string, unknown>>, b: [] as Array<Record<string, unknown>> };

  const installRoutes = async (page: Page, client: "a" | "b") => {
    await page.route("**/demo-assigned-calls.json", assignedCalls);
    await page.route("**/demo-open-calls.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
      openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString(),
    }) }));
    await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => {
      const response: OpenAssignmentResponse = {
        ...demoOpenAssignment as OpenAssignmentResponse,
        report: { ...demoOpenAssignment.report, revision: 1, document: serverDocument } as OpenAssignmentResponse["report"],
      };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
    });
    await page.route(`**/api/reports/${reportId}/active`, (route) => route.fulfill({
      contentType: "application/json",
      headers: { etag: `"report-${revision}-dispatch-0"` },
      body: JSON.stringify({ reportId, reportRevision: revision, dispatchRevision: 0,
        document: serverDocument, dispatchConflicts: [], dispatchCancellation: null }),
    }));
    await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
      const command = route.request().postDataJSON() as Record<string, unknown>;
      commands[client].push(command);
      if (client === "b" && commands.b.length === 1) {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ category: "server-conflict" }) });
      }
      revision += 1;
      serverDocument = client === "a"
        ? noteDocument("Client A replacement", "SERVER-UPDATE")
        : noteDocument("Client B replacement", "SERVER-UPDATE");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: reportId, status: "draft", revision }) });
    });
  };

  await installRoutes(pageA, "a");
  await installRoutes(pageB, "b");
  await Promise.all([signIn(pageA), signIn(pageB)]);
  await Promise.all([
    pageA.getByRole("button", { name: "Open call", exact: true }).click(),
    pageB.getByRole("button", { name: "Open call", exact: true }).click(),
  ]);
  await Promise.all([
    expect(pageA.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 }),
    expect(pageB.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 }),
  ]);

  await pageA.getByRole("button", { name: /Edit Clinical note.*Original shared note/ }).click();
  await pageA.getByLabel("Note summary").fill("Client A replacement");
  await pageA.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => commands.a.some((command) => JSON.stringify(command).includes("eNarrative.01"))).toBe(true);
  await expect(pageA.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });

  await pageB.getByRole("group", { name: "Documentation presentation" })
    .getByRole("button", { name: "Stationary" }).click();
  const narrative = pageB.locator('[data-element-id="eNarrative.01"] textarea');
  await narrative.fill("Client B replacement\n2026-09-03T12:01:00-04:00");
  await narrative.press("Tab");
  await expect.poll(() => commands.b.filter((command) => JSON.stringify(command).includes("eNarrative.01")).length,
    { timeout: 8_000 }).toBe(2);
  await expect(pageB.locator(".sync-status")).toHaveText("Saved", { timeout: 8_000 });

  const narrativeTarget = (command: Record<string, unknown>) =>
    (command.occurrences as Array<{ id: string; elementId: string }>).find(({ elementId }) => elementId === "eNarrative.01");
  const aNarrative = commands.a.map(narrativeTarget).filter((target) => target !== undefined);
  const bNarrative = commands.b.map(narrativeTarget).filter((target) => target !== undefined);
  expect(aNarrative).toHaveLength(1);
  expect(bNarrative).toHaveLength(2);
  expect(aNarrative[0]?.id).toBe(bNarrative[0]?.id);
  expect(bNarrative[1]?.id).toBe(bNarrative[0]?.id);
  expect(commands.b.every(({ deviceId }) => deviceId === `web:${reportId}`)).toBe(true);
  await expect(pageB.getByRole("textbox", { name: "First Name", exact: true })).toHaveValue("SERVER-UPDATE");
  await expect(narrative).toHaveValue(/^Client B replacement/);
  await contextA.close();
  await contextB.close();
});

test("a repeatedly rejected note save stops after one recovery request and remains actionable", async ({ page }) => {
  let saveRequests = 0;
  const serverDocument = noteDocument("Server winner", "SERVER-UPDATE");
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString(),
  }) }));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...demoOpenAssignment,
      report: { ...demoOpenAssignment.report, revision: 1, document: noteDocument("Original shared note") },
    }),
  }));
  await page.route(`**/api/reports/${reportId}/active`, (route) => route.fulfill({
    contentType: "application/json",
    headers: { etag: '"report-2-dispatch-0"' },
    body: JSON.stringify({ reportId, reportRevision: 2, dispatchRevision: 0,
      document: serverDocument, dispatchConflicts: [], dispatchCancellation: null }),
  }));
  await page.route(`**/api/reports/${reportId}/draft-changes`, (route) => {
    saveRequests += 1;
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ category: "server-conflict" }) });
  });

  await signIn(page);
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.getByRole("button", { name: /Edit Clinical note.*Original shared note/ }).click();
  await page.getByLabel("Note summary").fill("Keep this local correction");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Conflict", { timeout: 8_000 });
  expect(saveRequests).toBe(2);

  // Force the same refresh path used by foregrounding the browser. A terminal
  // queue must not be transformed into a fresh command by reconciliation.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1_500);
  expect(saveRequests).toBe(2);
  await expect(page.locator(".sync-status")).toHaveText("Conflict");
  await expect(page.getByRole("button", { name: /Edit Clinical note.*Keep this local correction/ })).toBeVisible();
});
