import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignmentId = demoAssignedCalls.assignedCalls[0]!.id;

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/calls/${assignmentId}/open`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(demoOpenAssignment) }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.evaluate(() => {
    class TestMediaRecorder extends EventTarget {
      static isTypeSupported(type: string) { return type.startsWith("audio/webm"); }
      state: RecordingState = "inactive";
      mimeType = "audio/webm;codecs=opus";
      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) { super(); }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.dispatchEvent(new BlobEvent("dataavailable", { data: new Blob(["voice"], { type: this.mimeType }) }));
        this.dispatchEvent(new Event("stop"));
      }
      pause() {} resume() {} requestData() {}
      ondataavailable = null; onerror = null; onpause = null; onresume = null; onstart = null; onstop = null;
      audioBitsPerSecond = 64_000; videoBitsPerSecond = 0;
      stream = {} as MediaStream; videoKeyFrameIntervalCount = undefined; videoKeyFrameIntervalDuration = undefined;
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: TestMediaRecorder });
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
  });
});

test("spoken-audio capture explains scope, exposes recording feedback, and requires an explicit interrupted choice", async ({ page }) => {
  await page.getByRole("button", { name: "Add audio note" }).click();
  const dialog = page.getByRole("dialog", { name: "Audio note" });
  await expect(dialog.getByText(/not a diagnostic-sound recorder/i)).toBeVisible();
  await expect(dialog.getByText(/does not transcribe speech/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect(dialog.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await expect(dialog.getByLabel(/Microphone input level/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dialog.getByText(/Recording interrupted/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Use .*recording/ })).toBeVisible();
  await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
  await expect(dialog.locator("textarea")).toHaveCount(1);
  const results = await new AxeBuilder({ page }).include(".audio-note-dialog").analyze();
  expect(results.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
});
