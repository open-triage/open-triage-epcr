import { expect, test, type Page } from "@playwright/test";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

const session = {
  csrfToken: "feedback-csrf-token",
  user: { id: "40000000-0000-4000-8000-000000000001", displayName: "Feedback Clinician" },
  organization: { id: "40000000-0000-4000-8000-000000000002", name: "Feedback EMS" },
  startedAt: "2026-09-16T10:00:00.000Z",
  expiresAt: "2099-09-16T20:00:00.000Z",
  capabilities: ["clinical:document"],
  workspaceAvailable: true
};

async function openAuthenticatedMobile(page: Page, language: "en" | "sv" = "en") {
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: session }));
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: { ...productionSettings, language } } }));
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: { assignedCalls: [], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() } }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: { reports: [] } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: language === "sv" ? "Skicka återkoppling" : "Send feedback" })).toBeVisible();
}

test("feedback cancel restores focus and failure preserves the selected draft", async ({ page }) => {
  await openAuthenticatedMobile(page);
  await page.route("**/api/reports/private-record**", (route) => route.fulfill({ status: 503, body: "SENSITIVE RESPONSE" }));
  await page.evaluate(async () => {
    await fetch("/api/reports/private-record?token=BEARER-SECRET&patient=PATIENT-123", {
      method: "POST", headers: { authorization: "Bearer AUTH-SECRET", "x-patient": "PATIENT-123" }, body: "SENSITIVE BODY"
    });
  });
  await page.getByRole("button", { name: "Choose language" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  let dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog.getByText("Do not include patient-identifying information.")).toBeVisible();
  await expect(dialog.getByLabel(/Choose Bug or Feature/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  let bugSubmission: any;
  await page.route("**/api/feedback/v1/submissions", async (route) => {
    bugSubmission = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 503, json: { message: "unavailable" } });
  });
  await trigger.click();
  dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByRole("button", { name: "Bug" }).click();
  const prompt = dialog.getByText("What happened, and what did you expect to happen?", { exact: true });
  await expect(dialog.getByLabel("What happened, and what did you expect to happen?")).toBeVisible();
  const description = dialog.getByRole("textbox");
  await description.focus();
  const [promptBox, descriptionBox] = await Promise.all([prompt.boundingBox(), description.boundingBox()]);
  expect(promptBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(promptBox!.y + promptBox!.height).toBeLessThanOrEqual(descriptionBox!.y - 6);
  await description.fill("The refresh control stopped responding");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("still here");
  await expect(description).toHaveValue("The refresh control stopped responding");
  expect(bugSubmission.diagnostics.status).toBe("available");
  expect(bugSubmission.diagnostics.payload.structure.nodes).not.toContainEqual(expect.objectContaining({ kind: "dialog" }));
  expect(bugSubmission.diagnostics.payload.interactions).toEqual(expect.arrayContaining([
    "feedback.opened", "feedback.type.bug.selected", "feedback.submit.attempted"
  ]));
  expect(bugSubmission.diagnostics.payload.requestFailures).toEqual(expect.arrayContaining([expect.objectContaining({
    method: "POST", endpointPattern: "/api/reports/{value}?patient={value}&token={value}", status: 503
  })]));
  expect(JSON.stringify(bugSubmission.diagnostics)).not.toMatch(/PATIENT-123|BEARER-SECRET|AUTH-SECRET|SENSITIVE BODY|SENSITIVE RESPONSE/);
});

test("feature feedback submits the type-specific prompt and announces its opaque reference", async ({ page }) => {
  await openAuthenticatedMobile(page);
  let submitted: unknown;
  await page.route("**/api/feedback/v1/submissions", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { accepted: true, referenceCode: "J7M4Q2K8X5PN" } });
  });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByRole("button", { name: "Feature" }).click();
  await dialog.getByLabel("What would you like to do, and why would it help?").fill("Filter calls by unit");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog).toHaveCount(0);
  const notice = page.getByRole("status").filter({ hasText: "Reference J7M4Q2K8X5PN" });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveClass(/transient-notice/);
  expect(await notice.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Choose language" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(notice).toHaveCount(0);
  expect(submitted).toMatchObject({ type: "feature", description: "Filter calls by unit" });
  expect((submitted as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  const diagnostics = (submitted as any).diagnostics;
  expect(diagnostics.status).toBe("available");
  expect(diagnostics.payload).toEqual(expect.objectContaining({
    schemaVersion: 1, mode: "mobile", screen: "calls", connectivity: "online"
  }));
  expect(diagnostics.payload).not.toHaveProperty("structure");
  expect(diagnostics.payload).not.toHaveProperty("interactions");
  expect(diagnostics.payload).not.toHaveProperty("requestFailures");
});

test("feedback remains first in each authenticated mode and is unavailable offline", async ({ page, context }) => {
  await openAuthenticatedMobile(page);
  const bar = page.locator(".session-bar");
  await expect(bar.locator("button").first()).toHaveAccessibleName("Send feedback");
  await page.getByRole("group", { name: "Documentation presentation" })
    .getByRole("button", { name: "Stationary" }).click();
  await expect(bar.locator("button").first()).toHaveAccessibleName("Send feedback");

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(bar.locator("button").first()).toBeDisabled();
  await expect(bar.locator("button").first()).toHaveAccessibleName("Send feedback unavailable while offline");
});

test("wide viewports keep the narrow mobile shell header and demo banner from overlapping", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1031 });
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), {
    ...session,
    user: { ...session.user, displayName: "Demo" },
    capabilities: ["clinical:demo", "clinical:document"]
  });
  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: { ...session, user: { ...session.user, displayName: "Demo" }, capabilities: ["clinical:demo", "clinical:document"] } }));
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: {
    assignedCalls: [], canceledAssignmentIds: [], refreshedAt: new Date().toISOString()
  } }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: { reports: [] } }));
  await page.route("**/api/calls/synthetic-generation", (route) => route.fulfill({ json: {
    eligibleUnits: [{ id: "40000000-0000-4000-8000-000000000003", callSign: "M1", name: "Medic 1" }],
    hasUnopenedCall: false
  } }));

  await page.goto("/");
  const bar = page.locator(".session-bar");
  const identity = page.locator(".session-identity");
  const selector = page.getByRole("group", { name: "Documentation presentation" });
  const banner = page.getByRole("note", { name: "Clinical Demo tools" });
  await expect(banner).toBeVisible();

  const [barBox, identityBox, selectorBox, bannerBox] = await Promise.all([
    bar.boundingBox(), identity.boundingBox(), selector.boundingBox(), banner.boundingBox()
  ]);
  expect(barBox).not.toBeNull();
  expect(identityBox).not.toBeNull();
  expect(selectorBox).not.toBeNull();
  expect(bannerBox).not.toBeNull();
  expect(barBox!.width).toBeLessThanOrEqual(480);
  expect(identityBox!.y + identityBox!.height).toBeLessThanOrEqual(selectorBox!.y);
  expect(bannerBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
});


test("Swedish feedback retains authored text and accessible focus after an upload failure", async ({ page }) => {
  await openAuthenticatedMobile(page, "sv");
  await page.route("**/api/feedback/v1/submissions", (route) => route.fulfill({ status: 503, json: { message: "unavailable" } }));
  const trigger = page.locator(".feedback-trigger");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Skicka återkoppling" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Bugg" }).click();
  const description = dialog.getByRole("textbox");
  const content = "Åke föreslår en bättre uppdragslista";
  await description.fill(content);
  await expect(dialog.locator("small").filter({ hasText: "tecken" })).toBeVisible();
  await dialog.getByRole("button", { name: "Skicka återkoppling" }).click();
  await expect(dialog.getByRole("alert")).toContainText("beskrivning finns kvar");
  await expect(description).toHaveValue(content);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
