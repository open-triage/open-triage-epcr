import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignmentId = demoAssignedCalls.assignedCalls[0]!.id;

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/calls/${assignmentId}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.evaluate(() => {
    const mediaDevices = navigator.mediaDevices;
    mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#275d38";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.captureStream(5);
    };
    mediaDevices.enumerateDevices = async () => ["rear-camera", "front-camera"].map((deviceId, index) => ({
      deviceId, groupId: "test-cameras", kind: "videoinput" as const,
      label: index === 0 ? "Rear camera" : "Front camera", toJSON: () => ({}),
    }));
  });
});

test("live camera and rotation preview remain accessible without exposing library or download controls", async ({ page }) => {
  await page.getByRole("button", { name: "Add photo note" }).click();
  const dialog = page.getByRole("dialog", { name: "Photo note" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Live camera preview")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cycle camera" })).toBeVisible();
  await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
  await expect(dialog.getByText(/never offered for selection/i)).toBeVisible();

  let results = await new AxeBuilder({ page }).include(".photo-note-dialog").analyze();
  expect(results.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);

  await dialog.getByRole("button", { name: "Take photo" }).click();
  await expect(dialog.getByAltText("Captured photo preview")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Rotate counterclockwise 90°" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Rotate clockwise 90°" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Discard & retake" })).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(0);

  results = await new AxeBuilder({ page }).include(".photo-note-dialog").analyze();
  expect(results.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
});

test("denied camera access gives recovery steps and leaves Text note available", async ({ page }) => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); };
  });
  await page.getByRole("button", { name: "Add photo note" }).click();
  const dialog = page.getByRole("dialog", { name: "Photo note" });
  await expect(dialog.getByRole("alert")).toContainText("Allow camera access for this site in browser settings");
  await expect(dialog.getByRole("alert")).toContainText("Text notes remain available");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Text note" }).click();
  await expect(page.getByLabel("Note text")).toBeFocused();
});
