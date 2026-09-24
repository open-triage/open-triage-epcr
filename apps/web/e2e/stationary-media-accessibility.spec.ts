import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall, OpenAssignmentResponse, ReportAudioNote, ReportPhotoNote } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignedCall = demoAssignedCalls.assignedCalls[0] as AssignedCall;
const reportId = demoOpenAssignment.report.id;
const author = { id: demoOpenAssignment.report.documentingUserId, displayName: "Alex Clinician" };
const photo: ReportPhotoNote = {
  id: "10000000-0000-4000-8000-000000000094", reportId, type: "photo", caption: "Medication label",
  capturedAt: "2026-09-24T18:36:00.000Z", capturedUtcOffsetMinutes: 120, author,
  serverReceivedAt: "2026-09-24T18:36:01.000Z", updatedAt: "2026-09-24T18:36:01.000Z",
  persistenceState: "ready", contentType: "image/jpeg", byteSize: 4, sha256: "a".repeat(64), width: 640, height: 480,
};
const audio: ReportAudioNote = {
  id: "10000000-0000-4000-8000-000000000095", reportId, type: "audio", caption: "Patient speaking clearly",
  capturedAt: "2026-09-24T18:37:00.000Z", capturedUtcOffsetMinutes: 120, author,
  serverReceivedAt: "2026-09-24T18:37:01.000Z", updatedAt: "2026-09-24T18:37:01.000Z",
  persistenceState: "ready", contentType: "audio/mp4", byteSize: 4, sha256: "b".repeat(64), durationMilliseconds: 4_000,
};

function assignedCalls(route: Route) {
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({
    assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString(),
  }) });
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("Stationary media filtering, viewing, playback, editing, deletion, focus, and responsive layout are accessible", async ({ page }) => {
  let revision = Number(demoOpenAssignment.report.revision);
  let currentPhoto = photo;
  let currentAudio = audio;
  const opened = { ...demoOpenAssignment,
    report: { ...demoOpenAssignment.report, notes: [audio, photo] } } as OpenAssignmentResponse;

  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = async function play() { return undefined; };
    HTMLMediaElement.prototype.pause = function pause() {};
  });
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(opened) }));
  await page.route("**/demo-open-assignment.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(opened) }));
  await page.route(`**/api/reports/${reportId}/photos/${photo.id}/image`, (route) => route.fulfill({ contentType: "image/jpeg", body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }));
  await page.route(`**/api/reports/${reportId}/audio/${audio.id}/content`, (route) => route.fulfill({ contentType: "audio/mp4", body: Buffer.from("audio") }));
  await page.route(`**/api/reports/${reportId}/photos/${photo.id}`, async (route) => {
    revision += 1;
    if (route.request().method() === "DELETE") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ reportId, noteId: photo.id, revision, deleted: true }) });
    currentPhoto = { ...currentPhoto, caption: route.request().postDataJSON().caption, updatedAt: new Date().toISOString() };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ reportId, revision, note: currentPhoto }) });
  });
  await page.route(`**/api/reports/${reportId}/audio/${audio.id}`, async (route) => {
    revision += 1;
    if (route.request().method() === "DELETE") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ reportId, noteId: audio.id, revision, deleted: true }) });
    currentAudio = { ...currentAudio, caption: route.request().postDataJSON().caption, updatedAt: new Date().toISOString() };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ reportId, revision, note: currentAudio }) });
  });

  await signIn(page);
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.getByRole("button", { name: /Timeline/ }).click();
  const sidebar = page.getByRole("complementary", { name: "Encounter timeline" });
  await sidebar.getByRole("group", { name: "Filter timeline" }).getByRole("button", { name: "Notes" }).click();
  await expect(sidebar.getByRole("button", { name: /Open photo note.*Medication label/ })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /Open audio note.*Patient speaking clearly/ })).toBeVisible();
  await expect(sidebar.locator("img.photo-thumbnail")).toHaveAttribute("alt", "");

  const directPlayback = sidebar.getByRole("button", { name: "Play audio note, 0:04" });
  await directPlayback.click();
  await expect(sidebar.getByRole("button", { name: "Pause audio note" })).toHaveAttribute("aria-pressed", "true");

  const photoTrigger = sidebar.getByRole("button", { name: /Open photo note.*Medication label/ });
  await photoTrigger.click();
  let dialog = page.getByRole("dialog", { name: "Photo note" });
  await expect(dialog.getByAltText("Medication label")).toBeVisible();
  await dialog.getByLabel("Caption").fill("Updated medication label");
  await dialog.getByRole("button", { name: "Save caption" }).click();
  await expect(sidebar.getByText("Updated medication label")).toBeVisible();
  await sidebar.getByRole("button", { name: /Open photo note.*Updated medication label/ }).click();
  await dialog.getByRole("button", { name: "Delete photo" }).click();
  await expect(page.getByRole("alertdialog", { name: "Photo note" }).getByRole("button", { name: "Keep photo" })).toBeFocused();
  await page.getByRole("alertdialog", { name: "Photo note" }).getByRole("button", { name: "Delete photo" }).click();
  await expect(sidebar.getByText("Updated medication label")).toHaveCount(0);

  await sidebar.getByRole("button", { name: /Open audio note.*Patient speaking clearly/ }).click();
  dialog = page.getByRole("dialog", { name: "Audio note" });
  await dialog.getByLabel("Caption").fill("Speech remains clear");
  await dialog.getByRole("button", { name: "Save caption" }).click();
  await expect(sidebar.getByText("Speech remains clear")).toBeVisible();
  await sidebar.getByRole("button", { name: /Open audio note.*Speech remains clear/ }).click();
  await dialog.getByRole("button", { name: "Delete audio" }).click();
  await expect(page.getByRole("alertdialog", { name: "Audio note" }).getByRole("button", { name: "Keep audio" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: "Delete audio" })).toBeFocused();
  await dialog.getByRole("button", { name: "Delete audio" }).click();
  await page.getByRole("alertdialog", { name: "Audio note" }).getByRole("button", { name: "Delete audio" }).click();
  await expect(sidebar.getByText("Speech remains clear")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = (await sidebar.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  const accessibility = await new AxeBuilder({ page }).include(".stationary-timeline-sidebar")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
});
