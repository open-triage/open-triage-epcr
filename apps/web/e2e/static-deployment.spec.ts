import { expect, test } from "@playwright/test";
import type { EncounterDocument } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

function valuesFor(elementIds: ReadonlyArray<string>): string[] {
  const document = demoOpenAssignment.report.document as EncounterDocument;
  return document.groups.flatMap(({ instances }) => instances)
    .flatMap(({ elements }) => elements)
    .filter(({ id }) => elementIds.includes(id))
    .flatMap(({ values }) => values)
    .flatMap((value) => "value" in value ? [String(value.value)] : "display" in value ? [String(value.display)] : []);
}

test("static deployment preserves the complete browser-only journey", async ({ page, request }) => {
  await expect.poll(async () => (await request.get("./")).status(), { timeout: 60_000 }).toBe(200);

  await page.goto("./");
  const deploymentOrigin = new URL(page.url()).origin;
  const unexpectedRequests: string[] = [];
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (url.origin !== deploymentOrigin && url.protocol !== "data:") unexpectedRequests.push(outgoing.url());
  });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await expect(page.getByLabel("Username")).toHaveValue("demo.clinician");
  await expect(page.getByLabel("Password")).toHaveValue("open-triage-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  const generatedCall = demoAssignedCalls.assignedCalls[0]!;
  const assignmentCard = page.getByRole("region", { name: "Assigned calls" }).locator(".assigned-call-card");
  await expect(assignmentCard).toContainText(generatedCall.callNumber);
  await expect(assignmentCard).toContainText(generatedCall.unit.callSign);
  await expect(assignmentCard).toContainText(generatedCall.dispatchReason);
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const safetyNotice = page.getByRole("note", { name: "Prototype safety notice" });
  await expect(safetyNotice).toContainText("Synthetic data only");
  await expect(safetyNotice).toContainText("not for clinical use");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.locator(".encounter-header")).toContainText(generatedCall.callNumber);
  await expect(page.locator(".encounter-header")).toContainText(generatedCall.unit.callSign);
  await expect(page.getByRole("button", { name: "Edit patient information" })).toHaveCount(0);
  for (const hidden of valuesFor(["ePatient.01", "ePatient.02", "ePatient.03", "ePatient.17", "ePatient.18", "ePatient.25"])) {
    await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
  }
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toContain("/open-triage-epcr-demo/");

  await page.getByRole("button", { name: "Add medication" }).click();
  await page.getByRole("searchbox", { name: /Search medications/ }).fill("morphine");
  await expect(page.getByRole("button", { name: /Morphine/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();

  await page.getByRole("button", { name: "Add procedure" }).click();
  await page.getByRole("searchbox", { name: /Search procedures/ }).fill("12 lead");
  await expect(page.getByRole("button", { name: /ECG, 12 lead/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();

  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Static deployment autosave check");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.getByText("Static deployment autosave check")).toBeVisible();
  await page.reload();
  await page.getByRole("region", { name: "Open calls" }).getByRole("button", { name: "Reopen call" }).click();
  await expect(page.getByText("Static deployment autosave check")).toBeVisible();
  await expect(safetyNotice).toContainText("not for clinical use");

  await page.context().setOffline(true);
  await page.reload();
  await page.getByRole("region", { name: "Open calls" }).getByRole("button", { name: "Reopen call" }).click();
  await expect(page.getByText("Static deployment autosave check")).toBeVisible();
  for (const hidden of valuesFor(["ePatient.01", "ePatient.02", "ePatient.03", "ePatient.17", "ePatient.18", "ePatient.25"])) {
    await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
  }

  await page.getByRole("button", { name: /Checklist, 0 errors, 1 warning/ }).click();
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expect(page.getByText("At least one set of vital signs should be documented.")).toBeVisible();
  await expect(safetyNotice).toContainText("Synthetic data only");

  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByRole("heading", { name: "Review and sign" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign record" })).toBeDisabled();
  await page.getByLabel("I reviewed and acknowledge this warning").check();
  await page.getByRole("button", { name: "Sign record" }).click();
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Open calls" }).getByText(generatedCall.callNumber, { exact: true })).toHaveCount(0);
  expect(unexpectedRequests).toEqual([]);
});
